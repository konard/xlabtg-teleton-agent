import { useState, type ComponentType } from 'react';
import { WelcomeStep } from '../components/setup/WelcomeStep';
import { ProviderStep } from '../components/setup/ProviderStep';
import { TelegramStep } from '../components/setup/TelegramStep';
import { ConfigStep } from '../components/setup/ConfigStep';
import { WalletStep } from '../components/setup/WalletStep';
import { ConnectStep } from '../components/setup/ConnectStep';
import { SetupComplete } from '../components/setup/SetupComplete';
import { getSteps, useSetup, type StepId, type StepProps } from '../components/setup/SetupContext';
import { setup } from '../lib/api';
import { useTranslation } from 'react-i18next';

// Re-export types for step components that import from here
export type { StepProps } from '../components/setup/SetupContext';

const STEP_COMPONENTS: Record<StepId, ComponentType<StepProps>> = {
  welcome: WelcomeStep,
  provider: ProviderStep,
  config: ConfigStep,
  wallet: WalletStep,
  telegram: TelegramStep,
  connect: ConnectStep,
};

export function Setup() {
  const { step, data, loading, error, saved, canAdvance, setData, next, prev, handleSave } =
    useSetup();
  const { t } = useTranslation();
  const [initDone, setInitDone] = useState(false);

  if (saved) {
    return <SetupComplete />;
  }

  const steps = getSteps(data.telegramMode);
  const currentStepIndex = Math.min(step, steps.length - 1);
  const StepComponent = STEP_COMPONENTS[steps[currentStepIndex].id];
  const nextStepLabel =
    currentStepIndex < steps.length - 1 ? t(`setup.steps.${steps[currentStepIndex + 1].id}`) : '';

  const handleRiskAcceptedChange = (accepted: boolean) => {
    setData({ ...data, riskAccepted: accepted });
    if (accepted && !initDone) {
      void setup
        .initWorkspace(data.agentName || undefined)
        .then(() => setInitDone(true))
        .catch(() => undefined);
    }
  };

  return (
    <>
      <StepComponent data={data} onChange={setData} />

      {error && <div className="alert error">{error}</div>}

      <div className="setup-nav">
        {step > 0 && (
          <button className="btn-ghost" onClick={prev} type="button">
            {t('setup.back')}
          </button>
        )}
        {currentStepIndex === 0 && (
          <label className="label-inline" style={{ cursor: 'pointer', margin: 0 }}>
            <input
              type="checkbox"
              checked={data.riskAccepted}
              onChange={(event) => handleRiskAcceptedChange(event.target.checked)}
            />
            <span>{t('setup.riskAccepted')}</span>
          </label>
        )}
        <div style={{ flex: 1 }} />
        {currentStepIndex < steps.length - 1 && (
          <button onClick={next} disabled={!canAdvance || loading} type="button">
            {loading ? (
              <>
                <span className="spinner sm" /> {t('setup.next')}
              </>
            ) : (
              t('setup.nextStep', { step: nextStepLabel })
            )}
          </button>
        )}
        {currentStepIndex === steps.length - 1 && data.telegramMode === 'bot' && (
          <button onClick={handleSave} disabled={!canAdvance || loading} type="button">
            {loading ? (
              <>
                <span className="spinner sm" /> {t('setup.saving')}
              </>
            ) : (
              t('setup.finish')
            )}
          </button>
        )}
        {/* Last user-account step (Connect): config auto-saves when Telegram auth succeeds. */}
      </div>
    </>
  );
}
