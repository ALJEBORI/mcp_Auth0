import { createContext, useContext, useState, useMemo, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Config {
	useBinding: boolean;
	accountId: string;
	apiKey: string;
}

interface ConfigContextValue {
	config: Config;
	setConfig: (config: Config) => void;
	isConfigured: boolean;
	headers: Record<string, string>;
}

const STORAGE_KEY = "cf-workers-ai-config-v1";

const EMPTY_CONFIG: Config = {
	useBinding: true,
	accountId: "",
	apiKey: "",
};

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function loadConfig(): Config {
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY);
		if (!raw) return EMPTY_CONFIG;
		const parsed = JSON.parse(raw);
		return {
			useBinding: parsed.useBinding ?? true,
			accountId: parsed.accountId ?? "",
			apiKey: parsed.apiKey ?? "",
		};
	} catch {
		return EMPTY_CONFIG;
	}
}

function saveConfig(config: Config) {
	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));
	} catch {
		// sessionStorage may be unavailable
	}
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
	const [config, setConfigState] = useState<Config>(loadConfig);

	const setConfig = (next: Config) => {
		setConfigState(next);
		saveConfig(next);
	};

	const isConfigured = config.useBinding || (!!config.accountId && !!config.apiKey);

	const headers = useMemo(() => {
		const h: Record<string, string> = {};
		if (config.useBinding) {
			h["X-Use-Binding"] = "true";
		} else {
			if (config.accountId) h["X-CF-Account-Id"] = config.accountId;
			if (config.apiKey) h["X-CF-Api-Key"] = config.apiKey;
		}
		return h;
	}, [config.useBinding, config.accountId, config.apiKey]);

	return (
		<ConfigContext.Provider value={{ config, setConfig, isConfigured, headers }}>
			{children}
		</ConfigContext.Provider>
	);
}

export function useConfig() {
	const ctx = useContext(ConfigContext);
	if (!ctx) throw new Error("useConfig must be used within ConfigProvider");
	return ctx;
}
