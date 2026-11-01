import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Stepper } from "@/lib/client/Stepper";
import { Segmented } from "@/lib/client/Segmented";

const steps = ["Navn", "Format", "Spillere", "Klokke"];

describe("Stepper", () => {
  it("markerer nåværende steg med aria-current=step og kun ett", () => {
    const html = renderToStaticMarkup(createElement(Stepper, { steps, current: 2, onStep: () => {} }));
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain("Steg 3 av 4 · Spillere");
  });

  it("tidligere steg er knapper, nåværende og senere steg er det ikke", () => {
    const html = renderToStaticMarkup(createElement(Stepper, { steps, current: 2, onStep: () => {} }));
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toMatch(/<button[^>]*>.*?Navn/);
    expect(html).toMatch(/<button[^>]*>.*?Format/);
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*Spillere/);
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*Klokke/);
  });

  it("klikk på tidligere steg kaller onStep med indeksen", () => {
    const onStep = vi.fn();
    const tree = Stepper({ steps, current: 2, onStep }) as unknown as { props: Record<string, unknown> };
    const buttons: Array<{ props: { onClick: () => void } }> = [];
    const walk = (n: unknown) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      const el = n as { type?: unknown; props?: { children?: unknown; onClick?: () => void } };
      if (el.type === "button") buttons.push(el as never);
      walk(el.props?.children);
    };
    walk(tree);
    expect(buttons).toHaveLength(2);
    buttons[1].props.onClick();
    expect(onStep).toHaveBeenCalledWith(1);
  });

  it("første steg: ingen knapper", () => {
    const html = renderToStaticMarkup(createElement(Stepper, { steps, current: 0, onStep: () => {} }));
    expect(html).not.toContain("<button");
  });
});

describe("Segmented", () => {
  it("er en radiogruppe med riktig aria-checked", () => {
    const html = renderToStaticMarkup(
      createElement(Segmented<string>, {
        value: "b",
        options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
        onChange: () => {},
        "aria-label": "Valg",
      }),
    );
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(2);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
  });
});
