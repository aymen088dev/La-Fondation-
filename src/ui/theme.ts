/**
 * Moteur UI NaLandia — API officielle Bedrock 1.26.
 *
 * Deux flux, un seul principe : le script envoie des formulaires NATIFS, le
 * Resource Pack habille. Aucune donnée de mise en page ne vit des deux côtés :
 *
 *  - `openTileMenu`  : menus à TUILES (`ActionFormData`). L'ORDRE des boutons
 *    EST le contrat (`./tiles.ts`) — c'est lui que le JSON UI généré par
 *    `scripts/build_ui.py` résout en `collection_index`. Les boutons `data`
 *    transportent du texte affiché ailleurs (descriptions, drapeaux).
 *  - `OMForm`        : formulaires à champs et fiches (`CustomForm`). Le
 *    Resource Pack ne fait que les habiller (`$custom_background`) : input
 *    natif garanti (tactile, manette, clavier).
 *
 * Si le Resource Pack est absent ou périmé, tout continue de fonctionner :
 * les formulaires retombent sur leur rendu vanilla (dégradation gracieuse).
 */
import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import {
  CustomForm as NativeCustomForm,
  FormCancelationReason,
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
import {
  TILE_MENUS,
  fitLabel,
  tileTitleFor,
  type TileMenuLayout,
  type TileSection,
} from "./tiles";

export const RP_PACK_ID = "33ca6e1c-4f30-46ae-8b56-1510382e3f61";
export const THEME = { primary: "§a", accent: "§6", danger: "§c", muted: "§7" } as const;
export type UIIcon = string;
export type HeroKind = string;

export * from "./tiles";

/** Interrupteur global d'habillage (conservé pour /sn:config côté main). */
let uiDesignEnabled = true;
export function setUiDesign(enabled: boolean): void {
  uiDesignEnabled = enabled;
}
export function isUiDesignEnabled(): boolean {
  return uiDesignEnabled;
}

/** Titre normalisé d'une section (« NaLandia » X ») — c'est LUI le contrat. */
export function windowTitle(section: string): string {
  return tileTitleFor(section as TileSection);
}

// ---------------------------------------------------------------------------
// Observables légers (le state local des formulaires à champs).
// ---------------------------------------------------------------------------

export class ObservableString {
  constructor(private value: string) {}
  getData(): string {
    return this.value;
  }
  setData(value: string): void {
    this.value = value;
  }
  subscribe(callback: (value: string) => void): (value: string) => void {
    return callback;
  }
  unsubscribe(_callback: (value: string) => void): boolean {
    return true;
  }
}
export class ObservableNumber {
  constructor(private value: number) {}
  getData(): number {
    return this.value;
  }
  setData(value: number): void {
    this.value = value;
  }
  subscribe(callback: (value: number) => void): (value: number) => void {
    return callback;
  }
  unsubscribe(_callback: (value: number) => void): boolean {
    return true;
  }
}
export class ObservableBoolean {
  constructor(private value: boolean) {}
  getData(): boolean {
    return this.value;
  }
  setData(value: boolean): void {
    this.value = value;
  }
  subscribe(callback: (value: boolean) => void): (value: boolean) => void {
    return callback;
  }
  unsubscribe(_callback: (value: boolean) => void): boolean {
    return true;
  }
}
export function obString(value: string): ObservableString {
  return new ObservableString(value);
}
export function obNumber(value: number): ObservableNumber {
  return new ObservableNumber(value);
}
export function obBool(value: boolean): ObservableBoolean {
  return new ObservableBoolean(value);
}
export function obToggle(value: boolean, callback: (value: boolean) => void): ObservableBoolean {
  const observable = new ObservableBoolean(value);
  observable.subscribe(callback);
  return observable;
}

// ---------------------------------------------------------------------------
// OMForm — formulaires à champs (CustomForm) et fiches.
// ---------------------------------------------------------------------------

export type DataDrivenScreenClosedReason = "UserClosed" | "UserBusy" | "ServerClosed";
export interface ButtonOptions {
  tooltip?: string;
}
export interface TextOptions {
  font_size?: unknown;
}
export interface DropdownItemData {
  label: string;
  value: number;
}
export interface SliderOptions {
  step?: number;
}
export interface TextFieldOptions {
  placeholder?: string;
  defaultValue?: string;
}

type Element =
  | { kind: "header" | "label" | "body" | "divider"; text: string }
  | { kind: "button"; text: string; onClick: () => void }
  | { kind: "image"; path: string; width: number }
  | { kind: "field"; add: (form: NativeCustomForm) => void };

function clean(text: string): string {
  return text
    .replace(/§h/g, "")
    .replace(/[■≡⬥✦╔╗╚╝█░▓━→←↔·]/g, "")
    .trim();
}

export class OMForm {
  private readonly elements: Element[] = [];
  private readonly titleText: string;
  private backAction: (() => void) | undefined;
  private activeForm: NativeCustomForm | undefined;
  private resolveShow: ((reason: DataDrivenScreenClosedReason) => void) | undefined;

  constructor(
    private readonly player: Player,
    title: string,
    _hero?: HeroKind,
  ) {
    this.titleText = title.replace(/§./g, "").trim();
  }

  hero(_kind: HeroKind): OMForm {
    return this;
  }
  image(path: string, width = 1): OMForm {
    this.elements.push({ kind: "image", path, width: Math.max(0.1, Math.min(1, width)) });
    return this;
  }
  header(text: string): OMForm {
    this.elements.push({ kind: "header", text: clean(text) });
    return this;
  }
  body(text: string): OMForm {
    this.elements.push({ kind: "body", text: clean(text) });
    return this;
  }
  label(text: string): OMForm {
    this.elements.push({ kind: "label", text: clean(text) });
    return this;
  }
  divider(): OMForm {
    this.elements.push({ kind: "divider", text: "" });
    return this;
  }
  spacer(): OMForm {
    this.elements.push({ kind: "label", text: " " });
    return this;
  }

  button(label: string, onClick: () => void, _options?: ButtonOptions, _icon?: UIIcon): OMForm {
    this.elements.push({ kind: "button", text: clean(label).replace(/\s*\n\s*/g, " "), onClick });
    return this;
  }

  back(onBack: () => void): OMForm {
    this.backAction = onBack;
    return this;
  }

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

  slider(
    label: string,
    observable: ObservableNumber,
    min: number,
    max: number,
    options?: SliderOptions,
  ): OMForm {
    const value = new NativeObservableNumber(observable.getData());
    value.subscribe((next) => observable.setData(next));
    // Le step est optionnel chez Mojang : ne PAS en forcer un — forcer 1
    // cassait les curseurs à pas fin (ex. pas de 15 min : rien ne bougeait).
    this.elements.push({
      kind: "field",
      add: (form) =>
        form.slider(label, value, min, max, options?.step === undefined ? undefined : { step: options.step }),
    });
    return this;
  }

  dropdown(label: string, observable: ObservableNumber, items: (DropdownItemData | string)[]): OMForm {
    const value = new NativeObservableNumber(observable.getData());
    value.subscribe((next) => observable.setData(next));
    const data = items.map((item, index) => ({
      label: typeof item === "string" ? item : item.label,
      value: typeof item === "string" ? index : item.value,
    }));
    this.elements.push({ kind: "field", add: (form) => form.dropdown(label, value, data) });
    return this;
  }

  textField(label: string, observable: ObservableString, _options?: TextFieldOptions): OMForm {
    const value = new NativeObservableString(observable.getData());
    value.subscribe((next) => observable.setData(next));
    this.elements.push({ kind: "field", add: (form) => form.textField(label, value) });
    return this;
  }

  closeButton(): OMForm {
    return this;
  }
  isShowing(): boolean {
    return this.resolveShow !== undefined;
  }
  closeIfShowing(): void {
    if (this.activeForm?.isShowing()) this.activeForm.close();
    this.activeForm = undefined;
    this.resolveShow = undefined;
  }

  show(): Promise<DataDrivenScreenClosedReason> {
    return new Promise((resolve) => {
      this.resolveShow = resolve;
      this.retryPresent(1, 0);
    });
  }

  /**
   * Ouvre le formulaire en RÉESSAYANT si le client refuse encore la demande :
   * le client termine parfois de fermer le formulaire précédent au moment où
   * le suivant arrive (UserBusy) — sans retry, le menu ne s'ouvrait JAMAIS.
   */
  private retryPresent(delay: number, attempt: number): void {
    system.runTimeout(() => {
      void this.present(attempt);
    }, delay);
  }

  private finish(reason: DataDrivenScreenClosedReason): void {
    const resolve = this.resolveShow;
    this.resolveShow = undefined;
    resolve?.(reason);
  }

  private async present(attempt = 0): Promise<void> {
    try {
      const form = new NativeCustomForm(this.player, this.titleText);
      this.activeForm = form;
      for (const element of this.elements) {
        if (element.kind === "button") {
          form.button(element.text, () => {
            // Une navigation ferme l'écran courant avant d'en ouvrir un autre ;
            // sinon le client peut garder l'ancien formulaire vivant.
            if (form.isShowing()) form.close();
            element.onClick();
          });
        } else if (element.kind === "image") {
          form.image(element.path, RP_PACK_ID, { width: element.width });
        } else if (element.kind === "header") {
          form.header(element.text);
        } else if (element.kind === "body" || element.kind === "label") {
          form.label(element.text);
        } else if (element.kind === "divider") {
          form.divider();
        } else if (element.kind === "field") {
          element.add(form);
        }
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
      if (reason === "UserBusy" && attempt < 4) {
        this.retryPresent(10, attempt + 1);
        return;
      }
      this.finish(reason === "ServerClosed" ? "ServerClosed" : reason === "UserBusy" ? "UserBusy" : "UserClosed");
    } catch (error: unknown) {
      this.activeForm = undefined;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < 4) {
        logMod.warn(`Menu « ${this.titleText} » : ${message} (nouvel essai)`);
        this.retryPresent(10, attempt + 1);
        return;
      }
      logMod.warn(`Menu « ${this.titleText} » : ${message}`);
      this.player.sendMessage(
        `§c[NaLandia] Le menu « ${this.titleText} » n'a pas pu s'afficher : §f${message}`,
      );
      this.finish("ServerClosed");
    }
  }
}

function buildAndShow(
  player: Player,
  title: string,
  build: (form: OMForm) => void,
): Promise<DataDrivenScreenClosedReason> {
  return new Promise((resolve, reject) => {
    system.runTimeout(() => {
      try {
        const form = new OMForm(player, title);
        build(form);
        form.show().then(resolve, reject);
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }, 1);
  });
}

export function openWindow(
  player: Player,
  section: string,
  build: (form: OMForm) => void,
): Promise<DataDrivenScreenClosedReason> {
  return buildAndShow(player, windowTitle(section), build).catch((error: unknown) => {
    logMod.warn(`openWindow(${section}) : ${error instanceof Error ? error.message : String(error)}`);
    return "ServerClosed" as const;
  });
}

export function openWindowRaw(
  player: Player,
  title: string,
  build: (form: OMForm) => void,
): Promise<DataDrivenScreenClosedReason> {
  return buildAndShow(player, title, build);
}

export function closeOpenForm(_player: Player): void {
  /* le CustomForm natif se ferme à l'ouverture d'un nouveau formulaire */
}

export type { MessageFormResponse };
export type NativeFormData = ActionFormData | ModalFormData | CustomForm;

// ---------------------------------------------------------------------------
// MENUS À TUILES — l'ordre des boutons est le contrat de RP/ui/server_form.json.
// ---------------------------------------------------------------------------

export interface TileMenuBuilder {
  /** Tuile cliquable (clé du contrat). */
  action(key: string, label: string, onClick: () => void): TileMenuBuilder;
  /**
   * Bouton INVISIBLE : ne sert qu'à transporter un texte que le JSON UI
   * affiche ailleurs (description d'une carte, identifiant du drapeau…).
   */
  data(key: string, text: string): TileMenuBuilder;
  /** Texte affiché dans la plaque latérale du panneau. */
  body(text: string): TileMenuBuilder;
}

interface TileAction {
  label: string;
  onClick: () => void;
}

/**
 * Ouvre un menu à tuiles. Les clés inconnues ou oubliées affichent une tuile
 * neutre (« — ») plutôt que de décaler les index : une erreur de câblage reste
 * visible à l'écran sans casser le reste du menu.
 */
export function openTileMenu(
  player: Player,
  section: TileSection,
  build: (menu: TileMenuBuilder) => void,
): void {
  const actions = new Map<string, TileAction>();
  const ordered: TileAction[] = [];
  const data = new Map<string, string>();
  let bodyText = "";

  const builder: TileMenuBuilder = {
    action(key, label, onClick) {
      const entry = { label, onClick };
      actions.set(key, entry);
      ordered.push(entry);
      return builder;
    },
    data(key, text) {
      data.set(key, text);
      return builder;
    },
    body(text) {
      bodyText = text;
      return builder;
    },
  };

  try {
    build(builder);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logMod.warn(`Construction du menu « ${section} » : ${message}`);
    return;
  }

  scheduleTileForm(player, section, actions, ordered, data, bodyText, 0);
}

function scheduleTileForm(
  player: Player,
  section: TileSection,
  actions: Map<string, TileAction>,
  ordered: TileAction[],
  data: Map<string, string>,
  bodyText: string,
  attempt: number,
): void {
  system.runTimeout(() => {
    void presentTileForm(player, section, actions, ordered, data, bodyText, attempt);
  }, attempt === 0 ? 1 : 10);
}

function layoutOf(section: TileSection): TileMenuLayout | undefined {
  return (TILE_MENUS.indexed as Record<string, TileMenuLayout>)[section];
}

async function presentTileForm(
  player: Player,
  section: TileSection,
  actions: Map<string, TileAction>,
  ordered: TileAction[],
  data: Map<string, string>,
  bodyText: string,
  attempt: number,
): Promise<void> {
  const layout = layoutOf(section);
  // Deux modes : emplacements DESSINÉS (contrat de clés, l'ordre impose les
  // positions) ou LISTE GÉNÉRIQUE (une tuile par bouton reçu, dans l'ordre).
  const sequential = layout === undefined;
  const form = new (await import("@minecraft/server-ui")).ActionFormData();
  form.title(tileTitleFor(section));
  if (bodyText.trim().length > 0) form.body(bodyText);
  if (sequential) {
    // Largeur FIXE des tuiles : un libellé trop long débordait de sa case.
    // La borne est appliquée ICI, une fois pour toutes.
    for (const entry of ordered) form.button(fitLabel(entry.label, 32));
  } else {
    for (const key of layout.actions) {
      form.button(actions.get(key)?.label ?? "§8—");
    }
    for (const key of layout.data) {
      form.button(data.get(key) ?? " ");
    }
  }

  let selection: number | undefined;
  try {
    const response = await form.show(player);
    // Le client refuse parfois d'ouvrir un formulaire juste après la fermeture
    // du précédent : on réessaie au lieu de laisser un menu qui ne s'ouvre pas.
    if (
      response.selection === undefined &&
      response.cancelationReason === FormCancelationReason.UserBusy &&
      attempt < 3
    ) {
      scheduleTileForm(player, section, actions, ordered, data, bodyText, attempt + 1);
      return;
    }
    selection = response.selection;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (attempt < 3) {
      scheduleTileForm(player, section, actions, ordered, data, bodyText, attempt + 1);
      return;
    }
    logMod.warn(`Menu « ${section} » : ${message}`);
    player.sendMessage(`§c[NaLandia] Le menu « ${section} » n'a pas pu s'afficher : §f${message}`);
    return;
  }

  if (selection === undefined) return;
  const action = sequential
    ? ordered[selection]
    : actions.get(layout.actions[selection] as string);
  if (action === undefined) return;
  const key = sequential ? String(selection) : (layout.actions[selection] as string);
  try {
    action.onClick();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logMod.warn(`Action « ${section}/${key} » : ${message}`);
  }
}
