import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CloudflareConfig {
	accountId: string;
	gatewayId: string;
	apiToken: string;
}

export interface ProviderKeys {
	openai: string;
	anthropic: string;
	gemini: string;
	grok: string;
	openrouter: string;
}

export interface DemoConfig {
	cloudflare: CloudflareConfig;
	providerKeys: ProviderKeys;
	/** When true, the worker uses env.AI / env.AI.gateway() bindings instead of REST credentials. */
	useBinding: boolean;
}

interface ConfigContextValue {
	config: DemoConfig;
	setCloudflare: (config: CloudflareConfig) => void;
	setProviderKey: (provider: keyof ProviderKeys, key: string) => void;
	setUseBinding: (value: boolean) => void;
	clearAll: () => void;
	isCloudflareConfigured: boolean;
	hasAnyProviderKey: boolean;
	/** Headers to include in every request to the worker */
	headers: Record<string, string>;
}

// ---------------------------------------------------------------------------
// SessionStorage helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = "cf-tanstack-ai-config-v2";

const EMPTY_CLOUDFLARE: CloudflareConfig = { accountId: "", gatewayId: "", apiToken: "" };
const EMPTY_PROVIDER_KEYS: ProviderKeys = {
	openai: "",
	anthropic: "",
	gemini: "",
	grok: "",
	openrouter: "",
};
const EMPTY_CONFIG: DemoConfig = {
	cloudflare: EMPTY_CLOUDFLARE,
	providerKeys: EMPTY_PROVIDER_KEYS,
	useBinding: true,
};

function loadConfig(): DemoConfig {
	try {
		// Use sessionStorage so API keys are not persisted beyond the browser tab.
		const raw = sessionStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<DemoConfig>;
			return {
				cloudflare: {
					accountId: parsed.cloudflare?.accountId ?? "",
					gatewayId: parsed.cloudflare?.gatewayId ?? "",
					apiToken: parsed.cloudflare?.apiToken ?? "",
				},
				providerKeys: {
					openai: parsed.providerKeys?.openai ?? "",
					anthropic: parsed.providerKeys?.anthropic ?? "",
					gemini: parsed.providerKeys?.gemini ?? "",
					grok: parsed.providerKeys?.grok ?? "",
					openrouter: parsed.providerKeys?.openrouter ?? "",
				},
				useBinding: parsed.useBinding ?? true,
			};
		}
	} catch {
		// Ignore parse errors
	}
	return EMPTY_CONFIG;
}

function saveConfig(config: DemoConfig) {
	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));
	} catch {
		// Ignore storage errors (e.g. private browsing)
	}
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
	const [config, setConfigState] = useState<DemoConfig>(loadConfig);

	const setCloudflare = useCallback((cf: CloudflareConfig) => {
		setConfigState((prev) => {
			const next = { ...prev, cloudflare: cf };
			saveConfig(next);
			return next;
		});
	}, []);

	const setProviderKey = useCallback((provider: keyof ProviderKeys, key: string) => {
		setConfigState((prev) => {
			const next = { ...prev, providerKeys: { ...prev.providerKeys, [provider]: key } };
			saveConfig(next);
			return next;
		});
	}, []);

	const setUseBinding = useCallback((value: boolean) => {
		setConfigState((prev) => {
			const next = { ...prev, useBinding: value };
			saveConfig(next);
			return next;
		});
	}, []);

	const clearAll = useCallback(() => {
		setConfigState(EMPTY_CONFIG);
		saveConfig(EMPTY_CONFIG);
	}, []);

	const cf = config.cloudflare;
	const pk = config.providerKeys;

	const isCloudflareConfigured = !!(
		cf.accountId.trim() &&
		cf.gatewayId.trim() &&
		cf.apiToken.trim()
	);

	const hasAnyProviderKey = !!(
		pk.openai.trim() ||
		pk.anthropic.trim() ||
		pk.gemini.trim() ||
		pk.grok.trim() ||
		pk.openrouter.trim()
	);

	const headers = useMemo((): Record<string, string> => {
		const h: Record<string, string> = {};
		if (config.useBinding) {
			h["X-Use-Binding"] = "true";
			// Binding mode still needs a gateway ID for env.AI.gateway(id)
			if (cf.gatewayId.trim()) h["X-CF-Gateway-Id"] = cf.gatewayId.trim();
		} else {
			// Cloudflare REST credentials
			if (cf.accountId.trim()) h["X-CF-Account-Id"] = cf.accountId.trim();
			if (cf.gatewayId.trim()) h["X-CF-Gateway-Id"] = cf.gatewayId.trim();
			if (cf.apiToken.trim()) h["X-CF-Api-Token"] = cf.apiToken.trim();
		}
		// Provider API keys (sent in both modes — useful for BYOK override)
		if (pk.openai.trim()) h["X-OpenAI-Api-Key"] = pk.openai.trim();
		if (pk.anthropic.trim()) h["X-Anthropic-Api-Key"] = pk.anthropic.trim();
		if (pk.gemini.trim()) h["X-Gemini-Api-Key"] = pk.gemini.trim();
		if (pk.grok.trim()) h["X-Grok-Api-Key"] = pk.grok.trim();
		if (pk.openrouter.trim()) h["X-OpenRouter-Api-Key"] = pk.openrouter.trim();
		return h;
	}, [
		config.useBinding,
		cf.accountId,
		cf.gatewayId,
		cf.apiToken,
		pk.openai,
		pk.anthropic,
		pk.gemini,
		pk.grok,
		pk.openrouter,
	]);

	const value = useMemo<ConfigContextValue>(
		() => ({
			config,
			setCloudflare,
			setProviderKey,
			setUseBinding,
			clearAll,
			isCloudflareConfigured,
			hasAnyProviderKey,
			headers,
		}),
		[
			config,
			setCloudflare,
			setProviderKey,
			setUseBinding,
			clearAll,
			isCloudflareConfigured,
			hasAnyProviderKey,
			headers,
		],
	);

	return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigContextValue {
	const ctx = useContext(ConfigContext);
	if (!ctx) {
		throw new Error("useConfig must be used within a ConfigProvider");
	}
	return ctx;
}
