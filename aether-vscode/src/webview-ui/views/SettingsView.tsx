/** @jsxImportSource preact */
import { h } from "preact";
import { useState, useEffect } from "preact/hooks";
import { Card, Button, Input, Select, Spinner } from "../components/ui";
import { rpcCall } from "../lib/message-bus";

interface SettingsSection {
  key: string;
  label: string;
  icon: string;
  fields: Record<string, any>;
}

function SettingsField({
  name,
  value,
  onChange,
}: {
  name: string;
  value: any;
  onChange: (v: any) => void;
}) {
  const type = typeof value;

  if (type === "boolean") {
    return (
      <label class="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
          class="rounded border-vsc-input-border bg-vsc-input-bg"
        />
        <span class="text-xs text-vsc-fg">{name}</span>
      </label>
    );
  }

  if (type === "number") {
    return (
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-vsc-desc">{name}</span>
        <input
          type="number"
          value={value}
          onChange={(e) =>
            onChange(Number((e.target as HTMLInputElement).value))
          }
          class="w-24 px-2 py-0.5 text-xs rounded border border-vsc-input-border bg-vsc-input-bg text-vsc-input-fg text-right focus:outline-none focus:ring-1 focus:ring-vsc-focus"
        />
      </div>
    );
  }

  if (
    type === "string" &&
    (name.toLowerCase().includes("key") ||
      name.toLowerCase().includes("secret"))
  ) {
    return (
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-vsc-desc">{name}</span>
        <input
          type="password"
          value={value}
          onChange={(e) => onChange((e.target as HTMLInputElement).value)}
          class="w-48 px-2 py-0.5 text-xs rounded border border-vsc-input-border bg-vsc-input-bg text-vsc-input-fg focus:outline-none focus:ring-1 focus:ring-vsc-focus"
        />
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <div>
        <span class="text-xs text-vsc-desc block mb-1">{name}</span>
        <pre class="text-[11px] text-vsc-fg bg-vsc-sidebar-bg rounded p-2 font-vsc-editor">
          {JSON.stringify(value, null, 2)}
        </pre>
      </div>
    );
  }

  if (type === "object" && value !== null) {
    return (
      <div>
        <span class="text-xs text-vsc-desc block mb-1">{name}</span>
        <pre class="text-[11px] text-vsc-fg bg-vsc-sidebar-bg rounded p-2 font-vsc-editor">
          {JSON.stringify(value, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs text-vsc-desc">{name}</span>
      <Input value={String(value ?? "")} onChange={onChange} className="w-48" />
    </div>
  );
}

export function SettingsView() {
  const [config, setConfig] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modified, setModified] = useState<Record<string, any>>({});
  const [saveStatus, setSaveStatus] = useState<"saved" | "error" | null>(null);

  useEffect(() => {
    rpcCall<Record<string, any>>("getConfig")
      .then((data) => data && setConfig(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (section: string, key: string, value: any) => {
    setModified((prev) => ({
      ...prev,
      [section]: { ...(prev[section] || {}), [key]: value },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const [section, updates] of Object.entries(modified)) {
        await rpcCall("updateConfig", { section, updates });
      }
      // Refresh config after save
      const data = await rpcCall<Record<string, any>>("getConfig");
      if (data) setConfig(data);
      setModified({});
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(null), 2000);
    } catch (err) {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div class="flex items-center justify-center h-full">
        <Spinner size={24} />
      </div>
    );
  }

  if (!config) {
    return (
      <div class="flex items-center justify-center h-full">
        <p class="text-sm text-vsc-desc">Failed to load configuration.</p>
      </div>
    );
  }

  const sections = Object.keys(config);
  const hasChanges = Object.keys(modified).length > 0;

  return (
    <div class="flex flex-col h-full animate-fade-in">
      <div class="flex items-center justify-between p-3 border-b border-vsc-border">
        <div class="flex items-center gap-2">
          <h3 class="text-sm font-semibold text-vsc-fg">AETHER Settings</h3>
          {saveStatus === "saved" && (
            <span class="text-[11px] text-emerald-400 animate-fade-in">✓ Saved</span>
          )}
          {saveStatus === "error" && (
            <span class="text-[11px] text-red-400 animate-fade-in">✕ Save failed</span>
          )}
        </div>
        <div class="flex gap-2">
          {hasChanges && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setModified({})}
            >
              Reset
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            loading={saving}
            disabled={!hasChanges}
          >
            Save Changes
          </Button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-3 space-y-3">
        {sections.map((section) => {
          const data = { ...config[section], ...(modified[section] || {}) };
          const fields =
            typeof data === "object" && data !== null
              ? Object.entries(data)
              : [];

          return (
            <details key={section} open class="group">
              <summary class="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-vsc-list-hover transition-colors">
                <span class="text-xs text-vsc-desc group-open:rotate-90 transition-transform">
                  ▶
                </span>
                <span class="text-sm font-medium text-vsc-fg capitalize">
                  {section}
                </span>
                {modified[section] && (
                  <span class="text-[10px] text-amber-400 ml-auto">
                    modified
                  </span>
                )}
              </summary>
              <div class="ml-6 mt-1 space-y-2 pb-2">
                {fields.map(([key, value]) => (
                  <SettingsField
                    key={key}
                    name={key}
                    value={value}
                    onChange={(v) => handleChange(section, key, v)}
                  />
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
