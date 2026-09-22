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
    COOKIE_SECRET: string; // <-- Add this line
    API_BASE_URL: string;
    // ... any other bindings
}