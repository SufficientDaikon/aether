/** @jsxImportSource preact */
import { h, type ComponentChildren } from "preact";
import { clsx } from "clsx";

// ─── Button ──────────────────────────────────────────────────

interface ButtonProps {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  className?: string;
  children?: ComponentChildren;
  title?: string;
}

export function Button({
  variant = "primary",
  size = "md",
  disabled,
  loading,
  onClick,
  className,
  children,
  title,
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded font-vsc transition-colors focus:outline-none focus:ring-1 focus:ring-vsc-focus disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-vsc-btn-bg text-vsc-btn-fg hover:bg-vsc-btn-hover",
    secondary:
      "bg-vsc-btn-secondary-bg text-vsc-btn-secondary-fg hover:opacity-80",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "bg-transparent text-vsc-fg hover:bg-vsc-list-hover",
  };
  const sizes = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-3 py-1 text-sm",
    lg: "px-4 py-1.5 text-base",
  };
  return (
    <button
      class={clsx(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      onClick={onClick}
      title={title}
    >
      {loading && (
        <span class="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
      )}
      {children}
    </button>
  );
}

// ─── Badge ───────────────────────────────────────────────────

interface BadgeProps {
  variant?: "default" | "success" | "warning" | "error" | "info";
  size?: "sm" | "md";
  className?: string;
  children?: ComponentChildren;
}

export function Badge({
  variant = "default",
  size = "sm",
  className,
  children,
}: BadgeProps) {
  const colors = {
    default: "bg-vsc-badge-bg text-vsc-badge-fg",
    success: "bg-emerald-600/20 text-emerald-400",
    warning: "bg-amber-600/20 text-amber-400",
    error: "bg-red-600/20 text-red-400",
    info: "bg-blue-600/20 text-blue-400",
  };
  const sz =
    size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";
  return (
    <span
      class={clsx(
        "inline-flex items-center rounded font-medium",
        colors[variant],
        sz,
        className,
      )}
    >
      {children}
    </span>
  );
}

// ─── Card ────────────────────────────────────────────────────

interface CardProps {
  title?: string;
  subtitle?: string;
  actions?: ComponentChildren;
  className?: string;
  children?: ComponentChildren;
  onClick?: () => void;
}

export function Card({
  title,
  subtitle,
  actions,
  className,
  children,
  onClick,
}: CardProps) {
  return (
    <div
      class={clsx(
        "rounded-lg border border-vsc-border bg-vsc-sidebar-bg p-4",
        onClick && "cursor-pointer hover:border-vsc-focus transition-colors",
        className,
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {(title || actions) && (
        <div class="flex items-center justify-between mb-2">
          <div>
            {title && (
              <h3 class="text-sm font-semibold text-vsc-fg">{title}</h3>
            )}
            {subtitle && <p class="text-xs text-vsc-desc mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div class="flex gap-1">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

// ─── Input ───────────────────────────────────────────────────

interface InputProps {
  type?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  error?: string;
  disabled?: boolean;
  className?: string;
}

export function Input({
  type = "text",
  placeholder,
  value,
  onChange,
  onKeyDown,
  error,
  disabled,
  className,
}: InputProps) {
  return (
    <div class="flex flex-col gap-0.5">
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onInput={(e) => onChange?.((e.target as HTMLInputElement).value)}
        onKeyDown={onKeyDown as any}
        disabled={disabled}
        class={clsx(
          "px-2.5 py-1 rounded border bg-vsc-input-bg text-vsc-input-fg text-sm font-vsc",
          "focus:outline-none focus:ring-1 focus:ring-vsc-focus",
          error ? "border-red-500" : "border-vsc-input-border",
          disabled && "opacity-50",
          className,
        )}
      />
      {error && <span class="text-[11px] text-red-400">{error}</span>}
    </div>
  );
}

// ─── Textarea ────────────────────────────────────────────────

interface TextareaProps {
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  rows?: number;
  disabled?: boolean;
  className?: string;
}

export function Textarea({
  placeholder,
  value,
  onChange,
  rows = 3,
  disabled,
  className,
}: TextareaProps) {
  return (
    <textarea
      placeholder={placeholder}
      value={value}
      onInput={(e) => onChange?.((e.target as HTMLTextAreaElement).value)}
      rows={rows}
      disabled={disabled}
      class={clsx(
        "px-2.5 py-1.5 rounded border border-vsc-input-border bg-vsc-input-bg text-vsc-input-fg text-sm font-vsc resize-y",
        "focus:outline-none focus:ring-1 focus:ring-vsc-focus",
        className,
      )}
    />
  );
}

// ─── Select ──────────────────────────────────────────────────

interface SelectOption {
  label: string;
  value: any;
  disabled?: boolean;
}

interface SelectProps {
  value?: any;
  onChange?: (value: any) => void;
  placeholder?: string;
  options: SelectOption[];
  disabled?: boolean;
  className?: string;
}

export function Select({
  value,
  onChange,
  placeholder,
  options,
  disabled,
  className,
}: SelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange?.((e.target as HTMLSelectElement).value)}
      disabled={disabled}
      class={clsx(
        "px-2.5 py-1 rounded border border-vsc-input-border bg-vsc-input-bg text-vsc-input-fg text-sm font-vsc",
        "focus:outline-none focus:ring-1 focus:ring-vsc-focus",
        className,
      )}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ─── Tabs ────────────────────────────────────────────────────

interface TabItem {
  id: string;
  label: string;
  icon?: string;
  badge?: number;
}

interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeTab, onChange, className }: TabsProps) {
  return (
    <div
      class={clsx("flex border-b border-vsc-border", className)}
      role="tablist"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          class={clsx(
            "px-3 py-2 text-xs font-medium transition-colors relative",
            "hover:text-vsc-fg focus:outline-none",
            activeTab === tab.id
              ? "text-vsc-fg after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-vsc-focus"
              : "text-vsc-desc",
          )}
          onClick={() => onChange(tab.id)}
        >
          <span class="flex items-center gap-1.5">
            {tab.icon && <span>{tab.icon}</span>}
            {tab.label}
            {tab.badge != null && tab.badge > 0 && (
              <span class="bg-vsc-badge-bg text-vsc-badge-fg text-[10px] px-1 rounded-full min-w-[16px] text-center">
                {tab.badge}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: "sm" | "md" | "lg";
  children?: ComponentChildren;
}

export function Modal({
  open,
  onClose,
  title,
  size = "md",
  children,
}: ModalProps) {
  if (!open) return null;
  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" };
  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div class="absolute inset-0 bg-black/50" />
      <div
        class={clsx(
          "relative rounded-lg border border-vsc-border bg-vsc-bg p-4 shadow-xl",
          widths[size],
          "w-full mx-4",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-sm font-semibold text-vsc-fg">{title}</h2>
            <button class="text-vsc-desc hover:text-vsc-fg" onClick={onClose}>
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

// ─── Progress ────────────────────────────────────────────────

interface ProgressProps {
  value: number;
  showLabel?: boolean;
  className?: string;
}

export function Progress({ value, showLabel, className }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div class={clsx("flex items-center gap-2", className)}>
      <div class="flex-1 h-1.5 bg-vsc-border rounded-full overflow-hidden">
        <div
          class="h-full bg-vsc-btn-bg rounded-full transition-all duration-300"
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel && (
        <span class="text-[10px] text-vsc-desc w-8 text-right">
          {Math.round(clamped)}%
        </span>
      )}
    </div>
  );
}

// ─── Spinner ─────────────────────────────────────────────────

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      class="animate-spin inline-block border-2 border-current border-t-transparent rounded-full"
      style={{ width: size, height: size }}
    />
  );
}

// ─── EmptyState ──────────────────────────────────────────────

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: ComponentChildren;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div class="flex flex-col items-center justify-center py-12 text-center">
      {icon && <span class="text-3xl mb-3 opacity-40">{icon}</span>}
      <h3 class="text-sm font-semibold text-vsc-fg">{title}</h3>
      {description && (
        <p class="text-xs text-vsc-desc mt-1 max-w-xs">{description}</p>
      )}
      {action && <div class="mt-3">{action}</div>}
    </div>
  );
}

// ─── Tooltip ─────────────────────────────────────────────────

interface TooltipProps {
  text: string;
  children: ComponentChildren;
}

export function Tooltip({ text, children }: TooltipProps) {
  return (
    <span class="relative group inline-flex" title={text}>
      {children}
    </span>
  );
}
