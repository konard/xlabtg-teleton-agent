import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { setup, SetupConfig, SETUP_AGENT_LAUNCH_TIMEOUT_MS } from '../../lib/api';

// ── Step metadata ───────────────────────────────────────────────────

const ALL_STEPS = [
  { id: 'welcome',  label: 'Welcome' },
  { id: 'provider', label: 'Provider' },
  { id: 'config',   label: 'Config' },
  { id: 'wallet',   label: 'Wallet' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'connect',  label: 'Connect' },
] as const;

export type StepId = (typeof ALL_STEPS)[number]['id'];
export type WizardStep = (typeof ALL_STEPS)[number];

const BOT_EXCLUDED_STEPS = new Set<StepId>(['telegram', 'connect']);
const BOT_STEPS = ALL_STEPS.filter((step) => !BOT_EXCLUDED_STEPS.has(step.id));

export const STEPS: readonly WizardStep[] = ALL_STEPS;

export function getSteps(telegramMode: WizardData['telegramMode']): readonly WizardStep[] {
  if (telegramMode === 'bot') {
    return BOT_STEPS;
  }
  return ALL_STEPS;
}

// ── Shared types ────────────────────────────────────────────────────

export interface WizardData {
  riskAccepted: boolean;
  agentName: string;
  provider: string;
  apiKey: string;
  gocoonPort: number;
  localUrl: string;
  apiId: number;
  apiHash: string;
  phone: string;
  userId: number;
  mode: 'quick' | 'advanced';
  telegramMode: 'user' | 'bot';
  model: string;
  customModel: string;
  dmPolicy: string;
  groupPolicy: string;
  requireMention: boolean;
  maxIterations: number;
  botToken: string;
  botUsername: string;
  tonapiKey: string;
  toncenterKey: string;
  tavilyKey: string;
  customizeThresholds: boolean;
  buyMaxFloor: number;
  sellMinFloor: number;
  walletAction: 'keep' | 'generate' | 'import';
  mnemonic: string;
  walletAddress: string;
  mnemonicSaved: boolean;
  authSessionId: string;
  telegramUser: { id: number; firstName: string; username: string } | null;
  authMode: 'qr' | 'phone';
  skipConnect: boolean;
  webuiEnabled: boolean;
  execMode: 'off' | 'yolo';
  exposeLan: boolean;
}

export interface StepProps {
  data: WizardData;
  onChange: (data: WizardData) => void;
}

const DEFAULTS: WizardData = {
  riskAccepted: false,
  agentName: 'Nova',
  provider: '',
  apiKey: '',
  gocoonPort: 10000,
  localUrl: 'http://localhost:11434/v1',
  apiId: 0,
  apiHash: '',
  phone: '',
  userId: 0,
  mode: 'quick',
  telegramMode: 'user',
  model: '',
  customModel: '',
  dmPolicy: 'admin-only',
  groupPolicy: 'admin-only',
  requireMention: true,
  maxIterations: 5,
  botToken: '',
  botUsername: '',
  tonapiKey: '',
  toncenterKey: '',
  tavilyKey: '',
  customizeThresholds: false,
  buyMaxFloor: 95,
  sellMinFloor: 105,
  walletAction: 'generate',
  mnemonic: '',
  walletAddress: '',
  mnemonicSaved: false,
  authSessionId: '',
  telegramUser: null,
  authMode: 'qr',
  skipConnect: false,
  webuiEnabled: false,
  execMode: 'off',
  exposeLan: false,
};

// ── Validation ──────────────────────────────────────────────────────

export function validateStep(step: number, data: WizardData): boolean {
  const stepId = getSteps(data.telegramMode)[step]?.id;

  switch (stepId) {
    case 'welcome':
      return data.riskAccepted;
    case 'provider':
      if (!data.provider) return false;
      if (data.provider === 'gocoon') {
        return data.gocoonPort >= 1 && data.gocoonPort <= 65535;
      }
      if (data.provider === 'local') {
        try { new URL(data.localUrl); return true; }
        catch { return false; }
      }
      if (data.provider === 'claude-code') {
        return true; // credentials auto-detected or fallback handled by ProviderStep
      }
      return data.apiKey.length > 0;
    case 'config': {
      // Config
      if (data.provider !== 'gocoon' && data.provider !== 'local') {
        const modelValue = data.model === '__custom__' ? data.customModel : data.model;
        if (!modelValue) return false;
      }
      if (data.telegramMode === 'bot' && !data.botToken.trim()) return false;
      return data.userId > 0 && data.maxIterations >= 1 && data.maxIterations <= 50;
    }
    case 'wallet':
      // Wallet: if generated/imported, must confirm mnemonic saved
      if (data.walletAction === 'keep') return true;
      if (!data.walletAddress) return false;
      return data.mnemonicSaved;
    case 'telegram':
      // User-account config still needs the account phone even when auth uses QR.
      if (data.apiId <= 0 || data.apiHash.length < 10) return false;
      return data.phone.startsWith('+');
    case 'connect':
      return data.telegramUser !== null || data.skipConnect;
    default:
      return false;
  }
}

// ── Context ─────────────────────────────────────────────────────────

interface SetupContextValue {
  step: number;
  data: WizardData;
  loading: boolean;
  error: string;
  saved: boolean;
  launching: boolean;
  launchError: string;
  canAdvance: boolean;
  setData: (data: WizardData) => void;
  next: () => void;
  prev: () => void;
  handleSave: () => Promise<void>;
  handleLaunch: () => Promise<void>;
}

const SetupContext = createContext<SetupContextValue | null>(null);

export function useSetup(): SetupContextValue {
  const ctx = useContext(SetupContext);
  if (!ctx) throw new Error('useSetup must be used inside SetupProvider');
  return ctx;
}

// ── Provider ────────────────────────────────────────────────────────

export function SetupProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState('');

  const steps = getSteps(data.telegramMode);
  const currentStepIndex = Math.min(step, steps.length - 1);
  const canAdvance = validateStep(currentStepIndex, data);

  useEffect(() => {
    setStep((s) => Math.min(s, getSteps(data.telegramMode).length - 1));
  }, [data.telegramMode]);

  const next = useCallback(() => {
    if (canAdvance) setStep((s) => Math.min(s + 1, getSteps(data.telegramMode).length - 1));
  }, [canAdvance, data.telegramMode]);

  const prev = useCallback(() => {
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  const buildConfig = useCallback((): SetupConfig => {
    const resolvedModel =
      data.model === '__custom__'
        ? data.customModel
        : data.model || undefined;
    const isBotMode = data.telegramMode === 'bot';

    return {
      agent: {
        provider: data.provider,
        ...(data.provider !== 'gocoon' && data.provider !== 'local' && data.apiKey ? { api_key: data.apiKey } : {}),
        ...(data.provider === 'local' ? { base_url: data.localUrl } : {}),
        ...(resolvedModel ? { model: resolvedModel } : {}),
        max_agentic_iterations: data.maxIterations,
      },
      telegram: {
        ...(isBotMode ? { mode: 'bot' as const } : {}),
        api_id: data.apiId,
        api_hash: data.apiHash,
        phone: data.phone,
        admin_ids: [data.userId],
        owner_id: data.userId,
        dm_policy: isBotMode ? 'admin-only' : data.dmPolicy,
        group_policy: data.groupPolicy,
        require_mention: isBotMode ? true : data.requireMention,
        ...(data.botToken ? { bot_token: data.botToken } : {}),
        ...(data.botUsername ? { bot_username: data.botUsername } : {}),
      },
      ...(data.provider === 'gocoon' ? { gocoon: { port: data.gocoonPort } } : {}),
      deals: {
        enabled: !!data.botToken,
        ...(data.customizeThresholds
          ? { buy_max_floor_percent: data.buyMaxFloor, sell_min_floor_percent: data.sellMinFloor }
          : {}),
      },
      capabilities: {
        exec: { mode: data.execMode },
      },
      ...(data.tonapiKey ? { tonapi_key: data.tonapiKey } : {}),
      ...(data.toncenterKey ? { toncenter_api_key: data.toncenterKey } : {}),
      ...(data.tavilyKey ? { tavily_api_key: data.tavilyKey } : {}),
      webui: { enabled: true },
      ...(data.exposeLan ? { api: { expose_lan: true } } : {}),
    };
  }, [data]);

  const handleSave = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await setup.saveConfig(buildConfig());
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [buildConfig]);

  const handleLaunch = useCallback(async () => {
    setLaunching(true);
    setLaunchError('');
    try {
      // The CLI embeds a one-time bootstrap nonce in the URL fragment
      // (#nonce=...). Fragments are not sent to the server or proxies, so
      // only a process that could see the CLI's own stderr/browser URL can
      // acquire it — which is exactly the trust boundary we want.
      const hash = window.location.hash.startsWith('#')
        ? window.location.hash.slice(1)
        : window.location.hash;
      const params = new URLSearchParams(hash);
      const nonce = params.get('nonce') ?? '';
      if (!nonce) {
        throw new Error(
          'Missing setup nonce. Open the URL printed by `teleton setup --ui` (it includes #nonce=…).'
        );
      }
      const { token } = await setup.launch(nonce);
      // Poll until the agent WebUI is up
      await setup.pollHealth(SETUP_AGENT_LAUNCH_TIMEOUT_MS);
      // Redirect to the dashboard with token-based auth
      window.location.href = `/auth/exchange?token=${encodeURIComponent(token)}`;
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(false);
    }
  }, []);

  // Persist config before Telegram auth, then auto-save when Telegram connects.
  // Phone-code and QR auth can create the Telegram session before config.yaml exists.
  const persistedRef = useRef(false);
  const persistConfig = useCallback(async () => {
    if (persistedRef.current) return;
    try {
      await setup.saveConfig(buildConfig());
      persistedRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [buildConfig]);

  useEffect(() => {
    const currentStepId = steps[currentStepIndex]?.id;
    if (currentStepId === 'connect' && data.telegramMode === 'user') {
      void persistConfig();
      return;
    }
    persistedRef.current = false;
  }, [currentStepIndex, data.telegramMode, persistConfig, steps]);

  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  useEffect(() => {
    if (steps[currentStepIndex]?.id === 'connect' && data.telegramUser && !saved && !loading) {
      saveRef.current();
    }
  }, [currentStepIndex, data.telegramUser, loading, saved, steps]);

  return (
    <SetupContext.Provider
      value={{
        step,
        data,
        loading,
        error,
        saved,
        launching,
        launchError,
        canAdvance,
        setData,
        next,
        prev,
        handleSave,
        handleLaunch,
      }}
    >
      {children}
    </SetupContext.Provider>
  );
}
