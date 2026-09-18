import type { JWTPayload } from "jose";

export type UserProps = {
    claims: JWTPayload;
    tokenSet: {
        accessToken: string;
        idToken: string;
        refreshToken: string;
    };
};

export interface Env {
    COOKIE_SECRET: string;
    // Add any other Auth0 or worker bindings here (e.g., AUTH0_CLIENT_ID, etc.)
}