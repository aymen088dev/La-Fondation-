/**
 * Adaptateur UI NaLandia basé sur CustomForm, l'API officielle Bedrock 1.26.
 *
 * CustomForm est le bon compromis pour ce projet : il est fourni par
 * @minecraft/server-ui, comprend boutons/champs/sections et gère nativement
 * le tactile, la manette, le clavier et le bouton de fermeture.
 */
import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import {
  CustomForm as NativeCustomForm,
  ObservableBoolean as NativeObservableBoolean,
  ObservableNumber as NativeObservableNumber,
  ObservableString as NativeObservableString,
} from "@minecraft/server-ui";
import type {
  ActionFormData,
  CustomForm,
  ModalFormData,
  MessageFormResponse,
} from "@minecraft/server-ui";
import { logMod } from "../lib/log";
import { designForSection, designForTitle, sheetTitleFor, TITLE_PREFIX, type ScreenDesign } from "./sheets";

export const RP_PACK_ID = "33ca6e1c-4f30-46ae-8b56-1510382e3f61";
export const THEME = { primary: "§a", accent: "§6", danger: "§c", muted: "§7" } as const;
export type UIIcon = string;
export * from "./sheets";
export type HeroKind = string;

let uiDesignEnabled = true;
export function setUiDesign(enabled: boolean): void { uiDesignEnabled = enabled; }
export function isUiDesignEnabled(): boolean { return uiDesignEnabled; }
export const UI_TITLE_TAG = "";
export function windowTitle(section: string): string { return `${TITLE_PREFIX}${section}`; }

/** Petits observables conservés pour ne pas réécrire les modules existants. */
export class ObservableString {
  constructor(private value: string) {}
  getData(): string { return this.value; }
  setData(value: string): void { this.value = value; }
  subscribe(callback: (value: string) => void): (value: string) => void { return callback; }
  unsubscribe(_callback: (value: string) => void): boolean { return true; }
}
export class ObservableNumber {
  constructor(private value: number) {}
  getData(): number { return this.value; }
  setData(value: number): void { this.value = value; }
  subscribe(callback: (value: number) => void): (value: number) => void { return callback; }
  unsubscribe(_callback: (value: number) => void): boolean { return true; }
}
export class ObservableBoolean {
  constructor(private value: boolean) {}
  getData(): boolean { return this.value; }
  setData(value: boolean): void { this.value = value; }
  subscribe(callback: (value: boolean) => void): (value: boolean) => void { return callback; }
  unsubscribe(_callback: (value: boolean) => void): boolean { return true; }
}
export function obString(value: string): ObservableString { return new ObservableString(value); }
export function obNumber(value: number): ObservableNumber { return new ObservableNumber(value); }
export function obBool(value: boolean): ObservableBoolean { return new ObservableBoolean(value); }
export function obToggle(value: boolean, callback: (value: boolean) => void): ObservableBoolean {
  const observable = new ObservableBoolean(value);
  observable.subscribe(callback);
  return observable;
}

export type DataDrivenScreenClosedReason = "UserClosed" | "UserBusy" | "ServerClosed";
export interface ButtonOptions { tooltip?: string; }
export interface TextOptions { font_size?: unknown; }
export interface DropdownItemData { label: string; value: number; }
export interface SliderOptions { step?: number; }
export interface TextFieldOptions { placeholder?: string; defaultValue?: string; }

type Element =
  | { kind: "header" | "label" | "body" | "divider"; text: string }
  | { kind: "button"; text: string; onClick: () => void }
  | { kind: "image"; path: string; width: number }
  | { kind: "field"; add: (form: NativeCustomForm) => void };

function clean(text: string): string {
  return text.replace(/§h/g, "").replace(/[■≡⬥✦╔╗╚╝█░▓━→←↔·]/g, "").trim();
}

export class OMForm {
  private readonly elements: Element[] = [];
  private readonly titleText: string;
  private backAction: (() => void) | undefined;
  private activeForm: NativeCustomForm | undefined;
  private resolveShow: ((reason: DataDrivenScreenClosedReason) => void) | undefined;
  readonly design: ScreenDesign;

  constructor(private readonly player: Player, title: string, _hero?: HeroKind, design?: ScreenDesign) {
    this.titleText = title.replace(/§./g, "").trim();
    this.design = design ?? designForTitle(this.titleText);
  }

  hero(_kind: HeroKind): OMForm { return this; }
  image(path: string, width = 1): OMForm {
    this.elements.push({ kind: "image", path, width: Math.max(0.1, Math.min(1, width)) });
    return this;
  }
  header(text: string): OMForm { this.elements.push({ kind: "header", text: clean(text) }); return this; }
  body(text: string): OMForm { this.elements.push({ kind: "body", text: clean(text) }); return this; }
  label(text: string): OMForm { this.elements.push({ kind: "label", text: clean(text) }); return this; }
  divider(): OMForm { this.elements.push({ kind: "divider", text: "" }); return this; }
  spacer(): OMForm { this.elements.push({ kind: "label", text: " " }); return this; }

  button(label: string, onClick: () => void, _options?: ButtonOptions, _icon?: UIIcon): OMForm {
    this.elements.push({ kind: "button", text: clean(label).replace(/\s*\n\s*/g, " "), onClick });
    return this;
  }

  back(onBack: () => void): OMForm { this.backAction = onBack; return this; }

  toggle(_label: string, initial: boolean): OMForm {
    const value = new NativeObservableBoolean(initial);
    this.elements.push({ kind: "field", add: (form) => form.toggle(_label, value) });
    return this;
  }

  toggleOb(label: string, observable: ObservableBoolean): OMForm {
    const value = new NativeObservableBoolean(observable.getData());
    value.subscribe((next) => observable.setData(next));
    this.elements.push({ kind: "field", add: (form) => form.toggle(label, value) });
    return this;
  }

  slider(label: string, observable: ObservableNumber, min: number, max: number, options?: SliderOptions): OMForm {
    const value = new NativeObservableNumber(observable.getData());
    value.subscribe((next) => observable.setData(next));
    this.elements.push({ kind: "field", add: (form) => form.slider(label, value, min, max, { step: options?.step ?? 1 }) });
    return this;
  }

  dropdown(label: string, observable: ObservableNumber, items: (DropdownItemData | string)[]): OMForm {
    const value = new NativeObservableNumber(observable.getData());
    value.subscribe((next) => observable.setData(next));
    const data = items.map((item, index) => ({ label: typeof item === "string" ? item : item.label, value: typeof item === "string" ? index : item.value }));
    this.elements.push({ kind: "field", add: (form) => form.dropdown(label, value, data) });
    return this;
  }

  textField(label: string, observable: ObservableString, _options?: TextFieldOptions): OMForm {
    const value = new NativeObservableString(observable.getData());
    value.subscribe((next) => observable.setData(next));
    // CustomForm garde la valeur dans l'observable ; le placeholder n'est pas
    // une option DDUI native (il est porté par le texte initial).
    this.elements.push({ kind: "field", add: (form) => form.textField(label, value) });
    return this;
  }

  closeButton(): OMForm { return this; }
  isShowing(): boolean { return this.resolveShow !== undefined; }
  closeIfShowing(): void {
    if (this.activeForm?.isShowing()) this.activeForm.close();
    this.activeForm = undefined;
    this.resolveShow = undefined;
  }

  show(): Promise<DataDrivenScreenClosedReason> {
    return new Promise((resolve) => {
      this.resolveShow = resolve;
      system.runTimeout(() => { void this.present(); }, 1);
    });
  }

  private finish(reason: DataDrivenScreenClosedReason): void {
    const resolve = this.resolveShow;
    this.resolveShow = undefined;
    resolve?.(reason);
  }

  private async present(): Promise<void> {
    try {
      const form = new NativeCustomForm(this.player, this.titleText);
      this.activeForm = form;

      // Vrais composants visuels CustomForm : ils sont générés par le script,
      // contrairement à l'ancien backdrop JSON UI qui ne faisait que changer
      // le fond. Chaque famille possède son bandeau et sa texture de carte.
      if (this.design === "cards") {
        form.image("textures/ui/om_header_band", RP_PACK_ID, { width: 1 });
        form.image("textures/ui/om_card", RP_PACK_ID, { width: 0.82 });
      } else if (this.design === "parchment") {
        form.image("textures/ui/om_sheet_pane", RP_PACK_ID, { width: 1 });
        form.image("textures/ui/om_content_bg", RP_PACK_ID, { width: 0.9 });
      } else {
        form.image("textures/ui/om_header_band", RP_PACK_ID, { width: 1 });
      }

      for (const element of this.elements) {
        if (element.kind === "button") {
          form.button(element.text, () => {
            // Une navigation doit fermer l'écran courant avant d'en ouvrir un
            // autre ; sinon le client peut garder l'ancien formulaire vivant.
            if (form.isShowing()) form.close();
            element.onClick();
          });
        } else if (element.kind === "image") form.image(element.path, RP_PACK_ID, { width: element.width });
        else if (element.kind === "header") form.header(element.text);
        else if (element.kind === "body" || element.kind === "label") form.label(element.text);
        else if (element.kind === "divider") form.divider();
        else if (element.kind === "field") element.add(form);
      }
      if (this.backAction !== undefined) {
        form.button("Retour", () => {
          if (form.isShowing()) form.close();
          this.backAction?.();
        });
      }
      form.closeButton();
      const reason = await form.show();
      this.activeForm = undefined;
      this.finish(reason === "UserBusy" ? "UserBusy" : reason === "ServerClosed" ? "ServerClosed" : "UserClosed");
    } catch (error: unknown) {
      this.activeForm = undefined;
      const message = error instanceof Error ? error.message : String(error);
      logMod.warn(`Menu « ${this.titleText} » : ${message}`);
      this.player.sendMessage(`§c[NaLandia] Le menu « ${this.titleText} » n'a pas pu s'afficher : §f${message}`);
      this.finish("ServerClosed");
    }
  }
}

function buildAndShow(player: Player, title: string, build: (form: OMForm) => void, design: ScreenDesign, hero?: HeroKind): Promise<DataDrivenScreenClosedReason> {
  return new Promise((resolve, reject) => {
    system.runTimeout(() => {
      try {
        const form = new OMForm(player, title, hero, design);
        build(form);
        form.show().then(resolve, reject);
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }, 1);
  });
}

export function openWindow(player: Player, section: string, build: (form: OMForm) => void, hero?: HeroKind): Promise<DataDrivenScreenClosedReason> {
  return buildAndShow(player, sheetTitleFor(section), build, designForSection(section), hero);
}
export function openWindowRaw(player: Player, title: string, build: (form: OMForm) => void): Promise<DataDrivenScreenClosedReason> {
  return buildAndShow(player, title, build, designForTitle(title.replace(/§./g, "").trim()));
}
export function closeOpenForm(_player: Player): void { /* native CustomForm closes on replacement */ }
export type { MessageFormResponse };
export type NativeFormData = ActionFormData | ModalFormData | CustomForm;
