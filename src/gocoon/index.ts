// Public gocoon API surface — CLI and WebUI import from here.
export {
  ensureGocoonBinaries,
  isInstalled,
  detectPlatform,
  type GocoonBinaries,
} from "./installer.js";
export { GocoonSupervisor, type SupervisorOptions } from "./supervisor.js";
export {
  init,
  waitFunded,
  walletInfo,
  topup,
  withdrawAll,
  tonToNano,
  type InitSummary,
  type WalletInfo,
  type ProgressSink,
  type GocoonProgress,
  type GocoonStage,
  type GocoonStatus,
} from "./lifecycle.js";
export {
  GOCOON_VERSION,
  GOCOON_DEFAULT_PORT,
  gocoonDataDir,
  clientConfigPath,
  runnerBaseUrl,
} from "./paths.js";
