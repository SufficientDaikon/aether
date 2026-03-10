// -----------------------------------------------------------------
// AETHER Powers — Public API
// -----------------------------------------------------------------

export {
  type PowerManifest,
  type PowerMcpConfig,
  type PowerActivation,
  type PowerDependencies,
  type InstalledPower,
  type ManifestValidationResult,
  validateManifest,
} from "./schema.ts";

export {
  type ConversationContext,
  type ActivationResult,
  DynamicActivator,
} from "./activator.ts";

export {
  type PendingActions,
  type InstallResult,
  type RemoveResult,
  type RegistryData,
  PowerInstaller,
} from "./installer.ts";

export { PowerRegistry } from "./registry.ts";
