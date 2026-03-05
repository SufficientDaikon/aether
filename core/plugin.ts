// -----------------------------------------------------------------
// AETHER Plugin System
//
// Define plugin slots that external code can fill. Plugins register
// hooks at specific lifecycle points. The PluginRegistry manages
// registration, initialization, and hook execution.
// -----------------------------------------------------------------

import type {
  PluginSlot,
  PluginContext,
  PluginResult,
  TaskRequest,
  TaskResult,
  AgentDefinition,
} from "./types.ts";

// -----------------------------------------------------------------
// Plugin Interface
// -----------------------------------------------------------------

/** Interface that all AETHER plugins must implement */
export interface AetherPlugin {
  /** Unique plugin identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Semantic version */
  version: string;
  /** Which lifecycle slots this plugin hooks into */
  slots: PluginSlot[];
  /** Called when the plugin is registered */
  init(context: {
    projectRoot: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  /** Called when a lifecycle hook fires */
  execute(slot: PluginSlot, context: PluginContext): Promise<PluginResult>;
  /** Called when the plugin is unregistered or on shutdown */
  destroy(): Promise<void>;
}

// -----------------------------------------------------------------
// Plugin Registry
// -----------------------------------------------------------------

export class PluginRegistry {
  private plugins: Map<string, AetherPlugin> = new Map();
  private slotIndex: Map<PluginSlot, Set<string>> = new Map();
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Register a plugin. Validates slots, calls init().
   * Throws if the plugin ID is already registered.
   */
  async register(plugin: AetherPlugin): Promise<void> {
    if (this.plugins.has(plugin.id)) {
      throw new Error("Plugin already registered: " + plugin.id);
    }

    // Validate slots
    const validSlots: PluginSlot[] = [
      "pre-execution",
      "post-execution",
      "pre-routing",
      "post-routing",
      "on-escalation",
      "on-error",
      "on-startup",
      "on-shutdown",
    ];
    for (const slot of plugin.slots) {
      if (!validSlots.includes(slot)) {
        throw new Error("Plugin " + plugin.id + " uses invalid slot: " + slot);
      }
    }

    // Initialize the plugin
    await plugin.init({
      projectRoot: this.projectRoot,
      metadata: {},
    });

    // Register
    this.plugins.set(plugin.id, plugin);

    // Index by slots
    for (const slot of plugin.slots) {
      if (!this.slotIndex.has(slot)) {
        this.slotIndex.set(slot, new Set());
      }
      this.slotIndex.get(slot)!.add(plugin.id);
    }
  }

  /**
   * Unregister a plugin. Calls destroy().
   */
  async unregister(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    await plugin.destroy();

    // Remove from slot index
    for (const slot of plugin.slots) {
      this.slotIndex.get(slot)?.delete(pluginId);
    }

    this.plugins.delete(pluginId);
  }

  /**
   * Execute all plugins registered for a given slot.
   * Returns aggregated results. If any plugin sets abort=true,
   * execution stops and that result is returned.
   */
  async executeHooks(
    slot: PluginSlot,
    context: PluginContext,
  ): Promise<PluginResult[]> {
    const pluginIds = this.slotIndex.get(slot);
    if (!pluginIds || pluginIds.size === 0) {
      return [];
    }

    const results: PluginResult[] = [];

    for (const pluginId of pluginIds) {
      const plugin = this.plugins.get(pluginId);
      if (!plugin) continue;

      try {
        const result = await plugin.execute(slot, context);
        results.push(result);

        // If a plugin requests abort, stop processing
        if (result.abort) break;
      } catch (err) {
        results.push({
          handled: false,
          abort: false,
          reason:
            "Plugin " +
            pluginId +
            " error: " +
            (err instanceof Error ? err.message : String(err)),
        });
      }
    }

    return results;
  }

  /**
   * Execute hooks and check if any requested abort.
   */
  async shouldAbort(
    slot: PluginSlot,
    context: PluginContext,
  ): Promise<{ abort: boolean; reason?: string }> {
    const results = await this.executeHooks(slot, context);
    const abortResult = results.find((r) => r.abort);
    if (abortResult) {
      return { abort: true, reason: abortResult.reason };
    }
    return { abort: false };
  }

  /** Get all registered plugin IDs */
  getPluginIds(): string[] {
    return [...this.plugins.keys()];
  }

  /** Get a plugin by ID */
  getPlugin(id: string): AetherPlugin | null {
    return this.plugins.get(id) ?? null;
  }

  /** Get all plugins registered for a slot */
  getPluginsForSlot(slot: PluginSlot): AetherPlugin[] {
    const ids = this.slotIndex.get(slot);
    if (!ids) return [];
    return [...ids]
      .map((id) => this.plugins.get(id))
      .filter((p): p is AetherPlugin => p !== undefined);
  }

  /** Get the count of registered plugins */
  get size(): number {
    return this.plugins.size;
  }

  /**
   * Shutdown all plugins. Called during runtime shutdown.
   */
  async destroyAll(): Promise<void> {
    // Execute on-shutdown hooks
    const shutdownContext: PluginContext = {
      slot: "on-shutdown",
      metadata: {},
    };

    for (const plugin of this.plugins.values()) {
      if (plugin.slots.includes("on-shutdown")) {
        try {
          await plugin.execute("on-shutdown", shutdownContext);
        } catch {
          // Swallow errors during shutdown
        }
      }
    }

    // Destroy all plugins
    for (const plugin of this.plugins.values()) {
      try {
        await plugin.destroy();
      } catch {
        // Swallow errors during shutdown
      }
    }

    this.plugins.clear();
    this.slotIndex.clear();
  }
}

// -----------------------------------------------------------------
// Helper: Build PluginContext from common inputs
// -----------------------------------------------------------------

/** Build a PluginContext for pre-execution hooks */
export function preExecutionContext(
  task: TaskRequest,
  agent: AgentDefinition,
): PluginContext {
  return {
    slot: "pre-execution",
    task,
    agent,
    metadata: {},
  };
}

/** Build a PluginContext for post-execution hooks */
export function postExecutionContext(
  task: TaskRequest,
  result: TaskResult,
  agent: AgentDefinition,
): PluginContext {
  return {
    slot: "post-execution",
    task,
    result,
    agent,
    metadata: {},
  };
}

/** Build a PluginContext for error hooks */
export function errorContext(
  error: Error,
  task?: TaskRequest,
  agent?: AgentDefinition,
): PluginContext {
  return {
    slot: "on-error",
    task,
    agent,
    error,
    metadata: {},
  };
}

/** Build a PluginContext for escalation hooks */
export function escalationContext(
  task: TaskRequest,
  agent: AgentDefinition,
  reason: string,
): PluginContext {
  return {
    slot: "on-escalation",
    task,
    agent,
    metadata: { escalationReason: reason },
  };
}
