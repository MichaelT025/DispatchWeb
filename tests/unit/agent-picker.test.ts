// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { AgentPicker } from "../../web/src/components/AgentPicker.js";
import { AGENT_ROLES, type AgentRole } from "../../web/src/agents.js";
import { LanguageProvider } from "../../web/src/i18n.js";

/**
 * AgentPicker 组件测试（jsdom）：验证角色按钮渲染、确认角色高亮（aria-pressed）、
 * busy 禁用、扩展缺失时的中性降级，以及选择后通过 onSelect 回传角色（真正的
 * `/agent <role>` 发送在 ChatInput 里完成，这里只验证选择事件本身）。
 */

interface Props {
	activeRole: AgentRole | null;
	available: boolean;
	busy: boolean;
	onSelect: (role: AgentRole) => void;
}

let root: Root | null = null;

function mount(props: Partial<Props> = {}) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	const onSelect = vi.fn();
	act(() => {
		root!.render(
			createElement(
				LanguageProvider,
				null,
				createElement(AgentPicker, {
					activeRole: null,
					available: true,
					busy: false,
					onSelect,
					...props,
				} as Props),
			),
		);
	});
	return { container, onSelect };
}

afterEach(() => {
	if (root) {
		act(() => root!.unmount());
		root = null;
	}
	document.body.innerHTML = "";
});

describe("AgentPicker", () => {
	it("renders the four roles and highlights only the confirmed active one", () => {
		const { container } = mount({ activeRole: "review" });
		const buttons = Array.from(container.querySelectorAll(".agent-picker-btn")) as HTMLButtonElement[];
		expect(buttons.map((b) => b.dataset.agentRole)).toEqual([...AGENT_ROLES]);

		const active = buttons.filter((b) => b.getAttribute("aria-pressed") === "true");
		expect(active).toHaveLength(1);
		expect(active[0].dataset.agentRole).toBe("review");
		expect(active[0].classList.contains("active")).toBe(true);
	});

	it("shows no pressed role when the role is unconfirmed (not optimistic)", () => {
		const { container } = mount({ activeRole: null });
		expect(container.querySelectorAll('.agent-picker-btn[aria-pressed="true"]')).toHaveLength(0);
	});

	it("disables every button while busy and explains why", () => {
		const { container } = mount({ busy: true });
		const buttons = Array.from(container.querySelectorAll(".agent-picker-btn")) as HTMLButtonElement[];
		expect(buttons.length).toBe(AGENT_ROLES.length);
		for (const b of buttons) expect(b.disabled).toBe(true);
		// 忙碌时可见文案给出原因（不是静默禁用）。
		const status = container.querySelector(".agent-picker-active") as HTMLElement;
		expect(status).not.toBeNull();
		expect(status.textContent?.trim().length).toBeGreaterThan(0);
	});

	it("neutral fallback when the extension is absent", () => {
		const { container } = mount({ available: false });
		expect(container.querySelector(".agent-picker-unavailable")).not.toBeNull();
		expect(container.querySelectorAll(".agent-picker-btn")).toHaveLength(0);
	});

	it("selecting a role fires onSelect with that role", () => {
		const { container, onSelect } = mount();
		const fast = container.querySelector('[data-agent-role="fast"]') as HTMLButtonElement;
		act(() => {
			fast.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(onSelect).toHaveBeenCalledWith("fast");
	});

	it("active label names the role in text (color is not the only signal)", () => {
		const { container } = mount({ activeRole: "general" });
		const label = container.querySelector(".agent-picker-active") as HTMLElement;
		const button = container.querySelector('[data-agent-role="general"]') as HTMLButtonElement;
		expect(label).not.toBeNull();
		expect(label.textContent).toContain(button.textContent ?? "");
	});
});
