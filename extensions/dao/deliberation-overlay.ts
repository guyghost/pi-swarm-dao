import type { Theme } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import {
  renderDeliberationLiveWidget,
  type DeliberationLiveState,
} from "./render.js";

interface TuiLike {
  requestRender(): void;
}

const styleLine = (theme: Theme, line: string): string => {
  if (
    line.startsWith("╭") ||
    line.startsWith("╰") ||
    line.startsWith("├") ||
    line.includes("│")
  ) {
    if (line.includes("APPROVED")) return theme.fg("success", line);
    if (line.includes("REJECTED") || line.includes("FAILED")) return theme.fg("error", line);
    if (line.includes("IN PROGRESS")) return theme.fg("accent", line);
    return theme.fg("borderAccent", line);
  }

  if (line.includes("✅") || line.includes("FOR +")) return theme.fg("success", line);
  if (line.includes("❌") || line.includes("⚠️") || line.includes("ERROR")) return theme.fg("error", line);
  if (line.includes("⏳") || line.includes("PENDING")) return theme.fg("warning", line);
  return theme.fg("text", line);
};

export class DeliberationOverlayComponent {
  readonly width = 96;

  private state?: DeliberationLiveState;
  private completed = false;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(
    private tui: TuiLike,
    private theme: Theme,
    private done: (value?: void) => void,
  ) {}

  setState(state: DeliberationLiveState, completed = false): void {
    this.state = state;
    this.completed = completed;
    this.invalidate();
    this.tui.requestRender();
  }

  close(): void {
    this.done();
  }

  handleInput(data: string): void {
    if (!this.completed) return;

    if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) {
      this.done();
    }
  }

  render(width: number): string[] {
    const targetWidth = Math.min(this.width, width);
    if (this.cachedLines && this.cachedWidth === targetWidth) {
      return this.cachedLines;
    }

    const body = this.state
      ? renderDeliberationLiveWidget(this.state)
      : ["Chargement de la délibération..."];

    const footer = this.completed
      ? this.theme.fg("dim", "Enter / Esc pour fermer")
      : this.theme.fg("dim", "Délibération en cours… fermeture automatique à la fin");

    const lines = [
      ...body.map((line) => truncateToWidth(styleLine(this.theme, line), targetWidth)),
      "",
      truncateToWidth(footer, targetWidth),
    ];

    this.cachedWidth = targetWidth;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}
