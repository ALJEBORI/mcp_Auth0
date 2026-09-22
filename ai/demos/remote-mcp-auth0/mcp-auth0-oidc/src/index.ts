import OAuthProvider, { type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { Hono } from "hono";
import { authorize, callback, confirmConsent, tokenExchangeCallback } from "./auth";
import type { UserProps } from "./types";

export class AuthenticatedMCP extends McpAgent<Env, Record<string, never>, UserProps> {
    server = new McpServer({
        name: "Auth0 OIDC Proxy Demo",
        version: "1.0.0",
    });

    async init() {
        // Useful for debugging. This will show the current user's claims and the Auth0 tokens.
        this.server.tool("whoami", "Get the current user's details", {}, async () => ({
            content: [{ text: JSON.stringify(this.props!.claims, null, 2), type: "text" }],
        }));

        // Call the Todos API on behalf of the current user.
        this.server.tool("list-todos", "List the current user's todos", {}, async () => {
            try {
                const response = await fetch(`${this.env.API_BASE_URL}/api/todos`, {
                    headers: {
                        Authorization: `Bearer ${this.props!.tokenSet.accessToken}`,
                    },
                });

                const data = await response.json();
                return {
                    content: [
                        {
                            text: JSON.stringify(data),
                            type: "text",
                        },
                    ],
                };
            } catch (e) {
                return {
                    content: [{ text: `The call to the Todos API failed: ${e}`, type: "text" }],
                };
            }
        });

        // Get the current user's billing settings.
        this.server.tool(
            "list-billing",
            "List the current user's billing settings",
            {},
            async () => {
                const response = await fetch(`${this.env.API_BASE_URL}/api/billing`, {
                    headers: {
                        Authorization: `Bearer ${this.props!.tokenSet.accessToken}`,
                    },
                });

                return {
                    content: [{ text: await response.text(), type: "text" }],
                };
            },
        );
    }
}

// Initialize the Hono app with the routes for the OAuth Provider.
const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

// Global middleware to log all incoming requests hitting Hono routes
app.use("*", async (c, next) => {
    console.log(`[Hono:Router] Incoming ${c.req.method} request to: ${c.req.url}`);
    console.log(`[Hono:Router] Headers -> Authorization:`, c.req.header("Authorization") ? "Present" : "Missing");
    console.log(`[Hono:Router] Headers -> Cookie:`, c.req.header("Cookie") ? "Present" : "Missing");
    await next();
    console.log(`[Hono:Router] Response status for ${c.req.path}:`, c.res.status);
});

app.get("/authorize", async (c) => {
    console.log("[Hono] Route hit: GET /authorize");
    try {
        return await authorize(c);
    } catch (err: any) {
        console.error("[Hono] CRITICAL ERROR in GET /authorize:", err);
        return c.text(`Internal Server Error: ${err.message || err}`, 500);
    }
});

app.post("/authorize", async (c) => {
    console.log("[Hono] Route hit: POST /authorize (Confirm Consent)");
    return confirmConsent(c);
});

app.get("/callback", async (c) => {
    console.log("[Hono] Route hit: GET /callback");
    return callback(c);
});
// Add this middleware right above your export default new OAuthProvider(...)
app.use("/authorize", async (c, next) => {
    const url = new URL(c.req.url);
    console.log("----------------------------------------");
    console.log("[Debug:Authorize] Client ID requested:", url.searchParams.get("client_id"));
    console.log("[Debug:Authorize] Full query params:", url.search);
    console.log("----------------------------------------");
    await next();
});
export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        // Optional safety check
        const provider = new OAuthProvider({
            apiHandler: AuthenticatedMCP.serve("/mcp"),
            apiRoute: "/mcp",
            authorizeEndpoint: "/authorize",
            clientRegistrationEndpoint: "/register",
            defaultHandler: app,
            tokenEndpoint: "/token",
            tokenExchangeCallback
        });

        return provider.fetch(request, env, ctx);
    }
};