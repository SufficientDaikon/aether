/** @jsxImportSource preact */
// Tests for UI components (Button, Badge, Card, Tabs, Input, Progress, EmptyState)
// Runs in jsdom environment

import { describe, it, expect, vi } from "vitest";
import { h } from "preact";
import { render, screen, fireEvent } from "@testing-library/preact";
import { Button, Badge, Card, Tabs, Input, Progress, EmptyState, Spinner } from "../../webview-ui/components/ui";

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText("Click me")).toBeTruthy();
  });

  it("calls onClick when clicked", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByText("Click"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not call onClick when disabled", () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByText("Click"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders loading spinner when loading=true", () => {
    const { container } = render(<Button loading>Loading</Button>);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("applies primary variant classes by default", () => {
    const { container } = render(<Button>Primary</Button>);
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("bg-vsc-btn-bg");
  });

  it("applies danger variant classes", () => {
    const { container } = render(<Button variant="danger">Delete</Button>);
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("bg-red-600");
  });

  it("applies sm size classes", () => {
    const { container } = render(<Button size="sm">Small</Button>);
    expect(container.querySelector("button")?.className).toContain("text-xs");
  });

  it("is disabled when loading is true", () => {
    const { container } = render(<Button loading>Loading</Button>);
    expect((container.querySelector("button") as HTMLButtonElement)?.disabled).toBe(true);
  });
});

describe("Badge", () => {
  it("renders children", () => {
    render(<Badge>42</Badge>);
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("applies success variant", () => {
    const { container } = render(<Badge variant="success">OK</Badge>);
    expect(container.querySelector("span")?.className).toContain("text-emerald-400");
  });

  it("applies error variant", () => {
    const { container } = render(<Badge variant="error">Err</Badge>);
    expect(container.querySelector("span")?.className).toContain("text-red-400");
  });

  it("applies md size classes", () => {
    const { container } = render(<Badge size="md">Big</Badge>);
    expect(container.querySelector("span")?.className).toContain("text-xs");
  });
});

describe("Card", () => {
  it("renders children", () => {
    render(<Card>Content</Card>);
    expect(screen.getByText("Content")).toBeTruthy();
  });

  it("renders title when provided", () => {
    render(<Card title="My Card">Body</Card>);
    expect(screen.getByText("My Card")).toBeTruthy();
  });

  it("renders subtitle when provided", () => {
    render(<Card title="Title" subtitle="Sub">Body</Card>);
    expect(screen.getByText("Sub")).toBeTruthy();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<Card onClick={onClick}>Clickable</Card>);
    fireEvent.click(screen.getByText("Clickable"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("has role=button when onClick provided", () => {
    render(<Card onClick={vi.fn()}>Btn</Card>);
    expect(screen.getByRole("button")).toBeTruthy();
  });

  it("does not have role=button without onClick", () => {
    render(<Card>Plain</Card>);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders action elements", () => {
    render(<Card title="T" actions={<button>Action</button>}>Body</Card>);
    expect(screen.getByText("Action")).toBeTruthy();
  });
});

describe("Tabs", () => {
  const tabs = [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
    { id: "c", label: "Gamma" },
  ];

  it("renders all tab labels", () => {
    render(<Tabs tabs={tabs} activeTab="a" onChange={vi.fn()} />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.getByText("Gamma")).toBeTruthy();
  });

  it("calls onChange with tab id on click", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} activeTab="a" onChange={onChange} />);
    fireEvent.click(screen.getByText("Beta"));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("marks active tab with aria-selected=true", () => {
    const { container } = render(<Tabs tabs={tabs} activeTab="b" onChange={vi.fn()} />);
    const buttons = container.querySelectorAll('[role="tab"]');
    const betaBtn = Array.from(buttons).find((b) => b.textContent?.includes("Beta"));
    expect(betaBtn?.getAttribute("aria-selected")).toBe("true");
  });

  it("shows tab badge when badge > 0", () => {
    const tabsWithBadge = [{ id: "x", label: "X", badge: 5 }];
    const { container } = render(<Tabs tabs={tabsWithBadge} activeTab="x" onChange={vi.fn()} />);
    expect(container.textContent).toContain("5");
  });

  it("renders tab icons when provided", () => {
    const tabsWithIcon = [{ id: "t", label: "Test", icon: "🧪" }];
    render(<Tabs tabs={tabsWithIcon} activeTab="t" onChange={vi.fn()} />);
    expect(screen.getByText("🧪")).toBeTruthy();
  });
});

describe("Input", () => {
  it("renders with placeholder", () => {
    render(<Input placeholder="Type here..." />);
    expect(screen.getByPlaceholderText("Type here...")).toBeTruthy();
  });

  it("calls onChange with new value on input", () => {
    const onChange = vi.fn();
    render(<Input onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.input(input, { target: { value: "hello" } });
    expect(onChange).toHaveBeenCalledWith("hello");
  });

  it("shows error message when error provided", () => {
    render(<Input error="This field is required" />);
    expect(screen.getByText("This field is required")).toBeTruthy();
  });

  it("is disabled when disabled=true", () => {
    render(<Input disabled />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("renders correct input type", () => {
    render(<Input type="password" />);
    const input = document.querySelector("input");
    expect(input?.type).toBe("password");
  });
});

describe("Progress", () => {
  it("renders a progress bar", () => {
    const { container } = render(<Progress value={50} />);
    // Structure: wrapper-div > track-div > fill-div (index 2)
    const innerBar = container.querySelectorAll("div")[2];
    expect(innerBar?.style.width).toBe("50%");
  });

  it("clamps value to 0-100", () => {
    const { container: c1 } = render(<Progress value={-10} />);
    const { container: c2 } = render(<Progress value={150} />);
    expect(c1.querySelectorAll("div")[2]?.style.width).toBe("0%");
    expect(c2.querySelectorAll("div")[2]?.style.width).toBe("100%");
  });

  it("shows percentage label when showLabel=true", () => {
    render(<Progress value={73} showLabel />);
    expect(screen.getByText("73%")).toBeTruthy();
  });

  it("does not show label by default", () => {
    render(<Progress value={50} />);
    expect(screen.queryByText("50%")).toBeNull();
  });
});

describe("EmptyState", () => {
  it("renders title", () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeTruthy();
  });

  it("renders description when provided", () => {
    render(<EmptyState title="Empty" description="No items found" />);
    expect(screen.getByText("No items found")).toBeTruthy();
  });

  it("renders icon when provided", () => {
    render(<EmptyState title="Empty" icon="📭" />);
    expect(screen.getByText("📭")).toBeTruthy();
  });

  it("renders action element", () => {
    render(<EmptyState title="Empty" action={<button>Create New</button>} />);
    expect(screen.getByText("Create New")).toBeTruthy();
  });
});

describe("Spinner", () => {
  it("renders a spinning element", () => {
    const { container } = render(<Spinner />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("applies custom size", () => {
    const { container } = render(<Spinner size={32} />);
    const el = container.querySelector(".animate-spin") as HTMLElement;
    expect(el?.style.width).toBe("32px");
    expect(el?.style.height).toBe("32px");
  });
});
