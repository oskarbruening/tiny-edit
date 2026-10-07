export type NoticeAction = { label: string; onClick: () => void };

/** The single-line bar above the editor used for conflicts, missing files and warnings. */
export class Notice {
  private readonly text: HTMLElement;
  private readonly actions: HTMLElement;

  constructor(private readonly host: HTMLElement) {
    host.classList.add("notice");
    host.hidden = true;
    host.setAttribute("role", "status");
    this.text = document.createElement("span");
    this.text.className = "notice__text";
    this.actions = document.createElement("span");
    this.actions.className = "notice__actions";
    host.append(this.text, this.actions);
  }

  show(message: string, actions: readonly NoticeAction[] = []): void {
    this.text.textContent = message;
    this.actions.replaceChildren(
      ...actions.map((a) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "notice__button";
        b.textContent = a.label;
        b.addEventListener("click", a.onClick);
        return b;
      }),
    );
    this.host.hidden = false;
  }

  hide(): void {
    this.host.hidden = true;
    this.text.textContent = "";
    this.actions.replaceChildren();
  }

  get visible(): boolean {
    return !this.host.hidden;
  }

  get message(): string {
    return this.text.textContent;
  }
}
