/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["src/webview-ui/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        vsc: {
          fg: "var(--vscode-foreground)",
          bg: "var(--vscode-editor-background)",
          border: "var(--vscode-panel-border)",
          "input-bg": "var(--vscode-input-background)",
          "input-fg": "var(--vscode-input-foreground)",
          "input-border": "var(--vscode-input-border)",
          "btn-bg": "var(--vscode-button-background)",
          "btn-fg": "var(--vscode-button-foreground)",
          "btn-hover": "var(--vscode-button-hoverBackground)",
          "btn-secondary-bg": "var(--vscode-button-secondaryBackground)",
          "btn-secondary-fg": "var(--vscode-button-secondaryForeground)",
          "badge-bg": "var(--vscode-badge-background)",
          "badge-fg": "var(--vscode-badge-foreground)",
          "sidebar-bg": "var(--vscode-sideBar-background)",
          "list-hover": "var(--vscode-list-hoverBackground)",
          "list-active": "var(--vscode-list-activeSelectionBackground)",
          "list-active-fg": "var(--vscode-list-activeSelectionForeground)",
          desc: "var(--vscode-descriptionForeground)",
          link: "var(--vscode-textLink-foreground)",
          error: "var(--vscode-errorForeground)",
          warning: "var(--vscode-editorWarning-foreground)",
          success: "var(--vscode-testing-iconPassed)",
          focus: "var(--vscode-focusBorder)",
        },
      },
      fontFamily: {
        vsc: "var(--vscode-font-family)",
        "vsc-editor": "var(--vscode-editor-font-family)",
      },
      fontSize: {
        vsc: "var(--vscode-font-size)",
        "vsc-editor": "var(--vscode-editor-font-size)",
      },
    },
  },
  plugins: [],
  corePlugins: {
    preflight: false,
  },
};
