/**
 * Adaptateur UI NaLandia — API officielle Bedrock 1.26.
 *
 * DEUX moteurs cohabitent, volontairement :
 *
 *  - `CustomForm` : formulaires à champs (texte, curseur, liste) et fiches de
 *    lecture. C'est le moteur « classique » du serveur (OMForm).
 *  - `ActionFormData` : menus à TUILES (Clan, Classes). La liste de boutons
 *    garde un INDEX stable, ce qui permet au Resource Pack de remplacer le
 *    rendu `long_form` par un panneau dessiné (voir `RP/ui/server_form.json`)
 *    tout en continuant à recevoir les clics EXACTEMENT comme un formulaire
 *    natif. Voir `./tiles.ts` pour le contrat d'ordre des boutons.
 *
 * Dans les deux cas la navigation reste native (tactile, manette, clavier) :
 * aucun curseur ni contrôle maison n'est injecté.
 */
import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import {
  ActionFormData as NativeActionForm,
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
import { designForSection, designForTitle, sheetTitleFor, TITLE_PREFIX, type ScreenDesign } from "./sheets";
import { TILE_MENUS, tileTitleFor, type TileSection } from "./tiles";

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
      this.retryPresent(1, 0);
    });
  }

  /**
   * Ouvre le formulaire, en RÉESSAYANT si le client refuse encore la demande.
   *
   * C'est indispensable depuis les menus à tuiles : le client termine de fermer
   * le formulaire à tuiles au moment où le suivant arrive, et il répondait
   * « UserBusy » (ou levait une erreur) — le menu ne s'ouvrait alors JAMAIS,
   * ce qui donnait l'impression d'un menu mort (liste des nations, sous-menus).
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
      if (reason === "UserBusy" && attempt < 4) {
        this.retryPresent(10, attempt + 1);
        return;
      }
      this.finish(reason === "UserBusy" ? "UserBusy" : reason === "ServerClosed" ? "ServerClosed" : "UserClosed");
    } catch (error: unknown) {
      this.activeForm = undefined;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < 4) {
        logMod.warn(`Menu « ${this.titleText} » : ${message} (nouvel essai)`);
        this.retryPresent(10, attempt + 1);
        return;
      }
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

// ---------------------------------------------------------------------------
// MENUS À TUILES (ActionFormData + JSON UI Bedrock)
// ---------------------------------------------------------------------------

/**
 * Constructeur d'un menu à tuiles. L'ORDRE des boutons est imposé par le JSON
 * UI, donc le script ne choisit pas où va une tuile : il fournit le contenu de
 * chaque clé déclarée dans `TILE_MENUS`, et l'adaptateur les envoie dans
 * l'ordre du contrat.
 */
export interface TileMenuBuilder {
  /** Tuile cliquable (index d'action). */
  action(key: string, label: string, onClick: () => void): TileMenuBuilder;
  /**
   * Bouton INVISIBLE : il ne sert qu'à transporter un texte que le JSON UI
   * affiche ailleurs (description d'une carte, identifiant du drapeau…).
   */
  data(key: string, text: string): TileMenuBuilder;
  /** Texte affiché au centre du panneau (bio, progression…). */
  body(text: string): TileMenuBuilder;
}

interface TileAction {
  label: string;
  onClick: () => void;
}

/**
 * Ouvre un menu à tuiles. Les clés inconnues ou oubliées affichent une tuile
 * neutre plutôt que de décaler les index : une erreur de câblage reste donc
 * visible à l'écran sans casser le reste du menu.
 */
export function openTileMenu(player: Player, section: TileSection, build: (menu: TileMenuBuilder) => void): void {
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

async function presentTileForm(
  player: Player,
  section: TileSection,
  actions: Map<string, TileAction>,
  ordered: TileAction[],
  data: Map<string, string>,
  bodyText: string,
  attempt: number,
): Promise<void> {
  const layout = TILE_MENUS[section];
  // Deux modes : emplacements DESSINÉS (contrat de clés, la mise en page impose
  // l'ordre) ou LISTE GÉNÉRIQUE (contrat vide : on envoie les actions dans
  // l'ordre et l'index de sélection EST l'index d'envoi).
  const sequential = layout.actions.length === 0;
  const form = new NativeActionForm();
  form.title(tileTitleFor(section));
  if (bodyText.trim().length > 0) form.body(bodyText);
  if (sequential) {
    for (const entry of ordered) form.button(entry.label);
  } else {
    for (const key of layout.actions) {
      form.button(actions.get(key)?.label ?? "§8—");
    }
  }
  for (const key of layout.data) {
    form.button(data.get(key) ?? " ");
  }

  let selection: number | undefined;
  try {
    const response = await form.show(player);
    // Le client refuse parfois d'ouvrir un formulaire juste après la fermeture
    // du précédent : dans ce cas on réessaie au lieu de laisser le joueur
    // devant un menu qui ne s'ouvre jamais.
    if (response.selection === undefined && response.cancelationReason === FormCancelationReason.UserBusy && attempt < 3) {
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

export { TILE_MENUS, tileTitleFor };
export type { TileSection };
