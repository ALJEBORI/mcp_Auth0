import { env } from "cloudflare:workers";
import type {
    AuthRequest,
    OAuthHelpers,
    TokenExchangeCallbackOptions,
    TokenExchangeCallbackResult,
} from "@cloudflare/workers-oauth-provider";
import type { Context } from "hono";
import * as oauth from "oauth4webapi";

import type { UserProps } from "./types";
import {
    addApprovedClient,
    bindStateToSession,
    createOAuthState,
    generateCSRFProtection,
    isClientApproved,
    OAuthError,
    renderApprovalDialog,
    validateCSRFToken,
    validateOAuthState,
} from "./workers-oauth-utils";

type Auth0AuthData = {
    codeVerifier: string;
    codeChallenge: string;
    nonce: string;
    transactionState: string;
    consentToken: string;
};

type ExtendedAuthRequest = AuthRequest & {
    auth0Data: Auth0AuthData;
};

export async function getOidcConfig({
    issuer,
    client_id,
    client_secret,
}: {
    issuer: string;
    client_id: string;
    client_secret: string;
}) {
    const as = await oauth
        .discoveryRequest(new URL(issuer), { algorithm: "oidc" })
        .then((response) => oauth.processDiscoveryResponse(new URL(issuer), response));

    const client: oauth.Client = { client_id };
    const clientAuth = oauth.ClientSecretPost(client_secret);

    return { as, client, clientAuth };
}

/**
 * OAuth Authorization Endpoint
 */
export async function authorize(c: Context<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>) {
    console.log("[Auth:Authorize] Incoming authorization request URL:", c.req.url);

    const mcpClientAuthRequest = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
console.log("[Auth:Authorize] RECEIVED CLIENT ID FROM MCP CLIENT:", mcpClientAuthRequest.clientId);
    console.log("[Auth:Authorize] Parsed MCP Auth Request:", {
        clientId: mcpClientAuthRequest.clientId,
        redirectUri: mcpClientAuthRequest.redirectUri,
        scope: mcpClientAuthRequest.scope,
    });

    if (!mcpClientAuthRequest.clientId) {
        console.warn("[Auth:Authorize] Rejected: Missing client ID");
        return c.text("Invalid request", 400);
    }

    const client = await c.env.OAUTH_PROVIDER.lookupClient(mcpClientAuthRequest.clientId);
    if (!client) {
        console.warn(`[Auth:Authorize] Rejected: Unknown client ID '${mcpClientAuthRequest.clientId}'`);
        return c.text("Invalid client", 400);
    }

    const isApproved = await isClientApproved(
        c.req.raw,
        mcpClientAuthRequest.clientId,
        c.env.COOKIE_ENCRYPTION_KEY,
    );
    console.log(`[Auth:Authorize] Client '${mcpClientAuthRequest.clientId}' approval status:`, isApproved);

    // Check if client is already approved
    if (isApproved) {
        console.log("[Auth:Authorize] Client already approved. Skipping dialog, generating state & redirecting to Auth0.");
        
        const codeVerifier = oauth.generateRandomCodeVerifier();
        const nonce = oauth.generateRandomNonce();
        const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);

        const auth0Data: Auth0AuthData = {
            codeChallenge,
            codeVerifier,
            consentToken: "",
            nonce,
            transactionState: "",
        };

        const extendedRequest: ExtendedAuthRequest = {
            ...mcpClientAuthRequest,
            auth0Data,
        };
        const { stateToken } = await createOAuthState(extendedRequest, c.env.OAUTH_KV);
        const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);

        const { as } = await getOidcConfig({
            client_id: c.env.AUTH0_CLIENT_ID,
            client_secret: c.env.AUTH0_CLIENT_SECRET,
            issuer: `https://${c.env.AUTH0_DOMAIN}/`,
        });

        const authorizationUrl = new URL(as.authorization_endpoint!);
        authorizationUrl.searchParams.set("client_id", c.env.AUTH0_CLIENT_ID);
        authorizationUrl.searchParams.set("redirect_uri", new URL("/callback", c.req.url).href);
        authorizationUrl.searchParams.set("response_type", "code");
        authorizationUrl.searchParams.set("audience", c.env.AUTH0_AUDIENCE);
        authorizationUrl.searchParams.set("scope", c.env.AUTH0_SCOPE);
        authorizationUrl.searchParams.set("code_challenge", codeChallenge);
        authorizationUrl.searchParams.set("code_challenge_method", "S256");
        authorizationUrl.searchParams.set("nonce", nonce);
        authorizationUrl.searchParams.set("state", stateToken);

        return new Response(null, {
            status: 302,
            headers: {
                Location: authorizationUrl.href,
                "Set-Cookie": sessionBindingCookie,
            },
        });
    }

    console.log("[Auth:Authorize] Client not approved yet. Rendering consent dialog.");

    // Generate CSRF protection for the approval form
    const { token: csrfToken, setCookie: csrfCookie } = generateCSRFProtection();

    const codeVerifier = oauth.generateRandomCodeVerifier();
    const nonce = oauth.generateRandomNonce();
    const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);

    const auth0Data: Auth0AuthData = {
        codeChallenge,
        codeVerifier,
        consentToken: "",
        nonce,
        transactionState: "",
    };

    return renderApprovalDialog(c.req.raw, {
        client,
        csrfToken,
        server: {
            description: "This is an Auth0 OIDC Proxy Demo MCP Server.",
            logo: undefined,
            name: "Auth0 OIDC Proxy Demo",
        },
        setCookie: csrfCookie,
        state: { oauthReqInfo: mcpClientAuthRequest, auth0Data },
    });
}

/**
 * Consent Confirmation Endpoint (POST /authorize)
 */
export async function confirmConsent(
    c: Context<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>,
) {
    try {
        console.log("[Auth:ConfirmConsent] Processing POST consent confirmation...");
        const formData = await c.req.formData();

        try {
            validateCSRFToken(formData, c.req.raw);
            console.log("[Auth:ConfirmConsent] CSRF token validated successfully.");
        } catch (csrfErr) {
            console.error("[Auth:ConfirmConsent] CSRF validation failed:", csrfErr);
            throw csrfErr;
        }

        const encodedState = formData.get("state");
        if (!encodedState || typeof encodedState !== "string") {
            console.warn("[Auth:ConfirmConsent] Missing state in form data.");
            return c.text("Missing state in form data", 400);
        }

        let state: { oauthReqInfo?: AuthRequest; auth0Data?: Auth0AuthData };
        try {
            state = JSON.parse(atob(encodedState));
            console.log("[Auth:ConfirmConsent] Successfully decoded form state data for client:", state?.oauthReqInfo?.clientId);
        } catch (_e) {
            console.error("[Auth:ConfirmConsent] Failed to decode base64/JSON state.");
            return c.text("Invalid state data", 400);
        }

        if (!state.oauthReqInfo || !state.oauthReqInfo.clientId || !state.auth0Data) {
            console.warn("[Auth:ConfirmConsent] Invalid request structure inside decoded state.");
            return c.text("Invalid request", 400);
        }

        const approvedClientCookie = await addApprovedClient(
            c.req.raw,
            state.oauthReqInfo.clientId,
            c.env.COOKIE_ENCRYPTION_KEY,
        );

        const extendedRequest: ExtendedAuthRequest = {
            ...state.oauthReqInfo,
            auth0Data: state.auth0Data,
        };
        const { stateToken } = await createOAuthState(extendedRequest, c.env.OAUTH_KV);
        const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);
        console.log("[Auth:ConfirmConsent] OAuth state successfully written to KV and bound to session.");

        const { as } = await getOidcConfig({
            client_id: c.env.AUTH0_CLIENT_ID,
            client_secret: c.env.AUTH0_CLIENT_SECRET,
            issuer: `https://${c.env.AUTH0_DOMAIN}/`,
        });

        const authorizationUrl = new URL(as.authorization_endpoint!);
        authorizationUrl.searchParams.set("client_id", c.env.AUTH0_CLIENT_ID);
        authorizationUrl.searchParams.set("redirect_uri", new URL("/callback", c.req.url).href);
        authorizationUrl.searchParams.set("response_type", "code");
        authorizationUrl.searchParams.set("audience", c.env.AUTH0_AUDIENCE);
        authorizationUrl.searchParams.set("scope", c.env.AUTH0_SCOPE);
        authorizationUrl.searchParams.set("code_challenge", state.auth0Data.codeChallenge);
        authorizationUrl.searchParams.set("code_challenge_method", "S256");
        authorizationUrl.searchParams.set("nonce", state.auth0Data.nonce);
        authorizationUrl.searchParams.set("state", stateToken);

        const headers = new Headers();
        headers.append("Set-Cookie", approvedClientCookie);
        headers.append("Set-Cookie", sessionBindingCookie);
        headers.set("Location", authorizationUrl.href);

        console.log("[Auth:ConfirmConsent] Redirecting user to Auth0...");
        return new Response(null, {
            status: 302,
            headers,
        });
    } catch (error: any) {
        console.error("[Auth:ConfirmConsent] Error caught in confirmConsent:", error);
        if (error instanceof OAuthError) {
            return error.toResponse();
        }
        return c.text(`Internal server error: ${error.message}`, 500);
    }
}

/**
 * OAuth Callback Endpoint
 */
export async function callback(c: Context<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>) {
    console.log("[Auth:Callback] Received callback from Auth0. URL:", c.req.url);

    let storedData: ExtendedAuthRequest;
    let clearSessionCookie: string;

    try {
        const result = await validateOAuthState(c.req.raw, c.env.OAUTH_KV);
        storedData = result.oauthReqInfo as ExtendedAuthRequest;
        clearSessionCookie = result.clearCookie;
        console.log("[Auth:Callback] State validation passed successfully for client:", storedData.clientId);
    } catch (error: any) {
        console.error("[Auth:Callback] State validation failed (KV/Cookie mismatch or expiration):", error);
        if (error instanceof OAuthError) {
            return error.toResponse();
        }
        return c.text("Internal server error", 500);
    }

    if (!storedData.clientId || !storedData.auth0Data) {
        console.warn("[Auth:Callback] Stored data missing clientId or auth0Data.");
        return c.text("Invalid OAuth request data", 400);
    }

    const auth0Data = storedData.auth0Data;
    const stateParam = c.req.query("state") as string;

    const { as, client, clientAuth } = await getOidcConfig({
        client_id: c.env.AUTH0_CLIENT_ID,
        client_secret: c.env.AUTH0_CLIENT_SECRET,
        issuer: `https://${c.env.AUTH0_DOMAIN}/`,
    });

    try {
        console.log("[Auth:Callback] Executing authorization code grant request with Auth0...");
        const params = oauth.validateAuthResponse(as, client, new URL(c.req.url), stateParam);
        const response = await oauth.authorizationCodeGrantRequest(
            as,
            client,
            clientAuth,
            params,
            new URL("/callback", c.req.url).href,
            auth0Data.codeVerifier,
        );

        const result = await oauth.processAuthorizationCodeResponse(as, client, response, {
            expectedNonce: auth0Data.nonce,
            requireIdToken: true,
        });

        const claims = oauth.getValidatedIdTokenClaims(result);
        if (!claims) {
            console.error("[Auth:Callback] Invalid or missing ID token claims received from Auth0.");
            return c.text("Received invalid id_token from Auth0", 400);
        }

        console.log("[Auth:Callback] Successfully verified user claims. User sub:", claims.sub);

        const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
            metadata: {
                label: claims.name || claims.email || claims.sub,
            },
            props: {
                claims: claims,
                tokenSet: {
                    accessToken: result.access_token,
                    accessTokenTTL: result.expires_in,
                    idToken: result.id_token,
                    refreshToken: result.refresh_token,
                },
            } as UserProps,
            request: storedData,
            scope: storedData.scope,
            userId: claims.sub!,
        });

        console.log("[Auth:Callback] Authorization complete. Redirecting client back to:", redirectTo);

        const headers = new Headers({ Location: redirectTo });
        if (clearSessionCookie) {
            headers.set("Set-Cookie", clearSessionCookie);
        }

        return new Response(null, {
            status: 302,
            headers,
        });
    } catch (err: any) {
        console.error("[Auth:Callback] Code exchange or token processing failed:", err);
        return c.text(`Token exchange failed: ${err.message}`, 500);
    }
}

/**
 * Token Exchange Callback
 */
export async function tokenExchangeCallback(
    options: TokenExchangeCallbackOptions,
): Promise<TokenExchangeCallbackResult | void> {
    console.log("[Auth:TokenExchange] Processing grant type:", options.grantType);

    if (options.grantType === "authorization_code") {
        return {
            accessTokenTTL: options.props.tokenSet.accessTokenTTL,
            newProps: {
                ...options.props,
            },
        };
    }

    if (options.grantType === "refresh_token") {
        const auth0RefreshToken = options.props.tokenSet.refreshToken;
        if (!auth0RefreshToken) {
            console.error("[Auth:TokenExchange] No Auth0 refresh token found in request props.");
            throw new Error("No Auth0 refresh token found");
        }

        const { as, client, clientAuth } = await getOidcConfig({
            client_id: env.AUTH0_CLIENT_ID,
            client_secret: env.AUTH0_CLIENT_SECRET,
            issuer: `https://${env.AUTH0_DOMAIN}/`,
        });

        console.log("[Auth:TokenExchange] Requesting refresh token grant from Auth0...");
        const response = await oauth.refreshTokenGrantRequest(
            as,
            client,
            clientAuth,
            auth0RefreshToken,
        );
        const refreshTokenResponse = await oauth.processRefreshTokenResponse(as, client, response);

        const claims = oauth.getValidatedIdTokenClaims(refreshTokenResponse);
        if (!claims) {
            console.error("[Auth:TokenExchange] Invalid ID token received during refresh.");
            throw new Error("Received invalid id_token from Auth0");
        }

        console.log("[Auth:TokenExchange] Refresh token successfully processed.");
        return {
            accessTokenTTL: refreshTokenResponse.expires_in,
            newProps: {
                ...options.props,
                claims: claims,
                tokenSet: {
                    accessToken: refreshTokenResponse.access_token,
                    accessTokenTTL: refreshTokenResponse.expires_in,
                    idToken: refreshTokenResponse.id_token,
                    refreshToken: refreshTokenResponse.refresh_token || auth0RefreshToken,
                },
            },
        };
    }
}