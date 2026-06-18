import { useTranslation } from 'react-i18next';
import { getSteps, useSetup } from './SetupContext';

export function SetupNav() {
  const { step, data } = useSetup();
  const { t } = useTranslation();
  const steps = getSteps(data.telegramMode);

  return (
    <div className="step-indicator">
      {steps.map((s, idx) => {
        const completed = idx < step;
        const active = idx === step;

        return (
          <div key={s.id} className="step-cell">
            <div className="step-cell-top">
              <div className={`step-dot${active ? ' active' : ''}${completed ? ' completed' : ''}`}>
                {completed ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <span>{idx + 1}</span>
                )}
              </div>
              {idx < steps.length - 1 && (
                <div className={`step-line${completed ? ' completed' : ''}`} />
              )}
            </div>
            <div className={`step-label${active ? ' active' : ''}${completed ? ' completed' : ''}`}>
              {t(`setup.steps.${s.id}`)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
