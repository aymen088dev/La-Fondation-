/**
 * Thème graphique commun à toutes les GUI OpenMontage.
 *
 * MOTEUR (v13) : formulaires VANILLA stables de @minecraft/server-ui :
 * - ActionFormData : menus à boutons (icônes du RP, labels multi-lignes,
 *   codes § rendus nativement) ;
 * - ModalFormData : formulaires à champs (switchs, sliders, dropdowns,
 *   champs texte — la vraie saisie).
 *
 * Le DDUI (CustomForm bêta) est ABANDONNÉ : observable clientWritable capricieux,
 * boutons mono-ligne sans codes §, écrans qui plantaient en silence. Les forms
 * vanilla sont rendues par notre reskin JSON UI (RP/ui/om_server_form.json) :
 * même habillage bleu nuit, sans les bugs.
 */

import { logMod } from "../lib/log";
import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import type {
  ActionFormResponse,
  ModalFormResponse,
  MessageFormResponse,
} from "@minecraft/server-ui";

/**
 * Identifiant du Resource Pack OpenMontage (icônes des boutons ActionForm).
 */
export const RP_PACK_ID = "33ca6e1c-4f30-46ae-8b56-1510382e3f61";

/** Palette du thème. */
export const THEME = {
  primary: "§a",
  accent: "§6",
  danger: "§c",
  muted: "§7",
} as const;

/**
 * Icônes OM (RP OpenMontage, tuiles 32x32 pixel-art générées par
 * scripts/make_ui_textures.py) — passées aux boutons ActionFormData.
 */
const OM_ICONS = {
  flag: "flag",
  compass: "compass",
  shield: "shield",
  crown: "crown",
  scroll: "scroll",
  gear: "gear",
  database: "database",
  sword: "sword",
  ban: "ban",
  bell: "bell",
  warn: "warn",
  history: "history",
  plus: "plus",
  check: "check",
  trash: "trash",
  search: "search",
  save: "save",
  back: "back",
  close: "close",
  list: "list",
  pencil: "pencil",
  user: "user",
  tag: "tag",
  online: "online",
  axe: "axe",
  pickaxe: "pickaxe",
  hammer: "hammer",
} as const;

export type UIIcon = keyof typeof OM_ICONS;

/** Chemin RP d'une icône OM (tuile 32x32). */
export function OM_ICON(icon: UIIcon): string {
  return `textures/ui/om_ic_${OM_ICONS[icon]}.png`;
}

/** Alias de compat : les menus historiques importent ICONS. */
export const ICONS = OM_ICONS;

/**
 * Bannières de héros (RP OpenMontage, 256x48) affichées en tête des menus
 * principaux comme image dans le body.
 */
const HEROES = {
  home: "om_hero_home",
  territories: "om_hero_territories",
  admin: "om_hero_admin",
  mod: "om_hero_mod",
  role: "om_hero_role",
  modules: "om_hero_modules",
  database: "om_hero_database",
  classes: "om_hero_classes",
  jobs: "om_hero_jobs",
} as const;

export type HeroKind = keyof typeof HEROES;

/** Chemin RP d'une bannière de héros. */
function heroPath(kind: HeroKind): string {
  return `textures/ui/${HEROES[kind]}.png`;
}

/**
 * Interrupteur du design image (héros + icônes) : /scriptevent sn:ui off|on.
 */
let uiDesignEnabled = true;

function disableUiDesign(reason: string): void {
  if (!uiDesignEnabled) return;
  uiDesignEnabled = false;
  logMod.warn(
    `Images désactivées automatiquement (${reason}) — menus sans image pour rester fonctionnels. /scriptevent sn:ui on pour réactiver.`,
  );
}
void disableUiDesign;

/** Active/désactive le design image (héros + icônes). */
export function setUiDesign(enabled: boolean): void {
  uiDesignEnabled = enabled;
}

/** État actuel du design image. */
export function isUiDesignEnabled(): boolean {
  return uiDesignEnabled;
}

/** Construit un titre de fenêtre normalisé : "OM » <title>" (gras, vert/gris). */
export function windowTitle(section: string): string {
  return `§l§aOM §r§8» §r§l${section}`;
}

// ---------------------------------------------------------------------------
// Shims observables (compat des menus écrits pour le DDUI) : valeur + callbacks.
// Le moteur vanilla ne connaît pas ce concept — on lit la valeur au submit.
// ---------------------------------------------------------------------------

export class ObservableString {
  private value: string;
  constructor(initial: string, _options?: unknown) {
    this.value = initial;
  }
  getData(): string {
    return this.value;
  }
  setData(data: string): void {
    this.value = data;
  }
  subscribe(_cb: (v: string) => void): (v: string) => void {
    return _cb;
  }
  unsubscribe(_cb: (v: string) => void): boolean {
    return true;
  }
}

export class ObservableNumber {
  private value: number;
  constructor(initial: number, _options?: unknown) {
    this.value = initial;
  }
  getData(): number {
    return this.value;
  }
  setData(data: number): void {
    this.value = data;
  }
  subscribe(_cb: (v: number) => void): (v: number) => void {
    return _cb;
  }
  unsubscribe(_cb: (v: number) => void): boolean {
    return true;
  }
}

export class ObservableBoolean {
  private value: boolean;
  constructor(initial: boolean, _options?: unknown) {
    this.value = initial;
  }
  getData(): boolean {
    return this.value;
  }
  setData(data: boolean): void {
    this.value = data;
  }
  subscribe(_cb: (v: boolean) => void): (v: boolean) => void {
    return _cb;
  }
  unsubscribe(_cb: (v: boolean) => void): boolean {
    return true;
  }
}

/** Texte lié (champ éditable). */
export function obString(initial: string): ObservableString {
  return new ObservableString(initial);
}

/** Nombre lié (slider, dropdown). */
export function obNumber(initial: number): ObservableNumber {
  return new ObservableNumber(initial);
}

/** Booléen lié (toggle). */
export function obBool(initial: boolean): ObservableBoolean {
  return new ObservableBoolean(initial);
}

/** Booléen lié avec callback au changement (compat). */
export function obToggle(initial: boolean, onChange: (value: boolean) => void): ObservableBoolean {
  const observable = new ObservableBoolean(initial);
  observable.subscribe(onChange);
  return observable;
}

// ---------------------------------------------------------------------------
// Types du moteur OM (implémentés sur les forms vanilla)
// ---------------------------------------------------------------------------

/** État de fermeture d'un écran (compat avec l'ancien moteur DDUI). */
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

interface ActionEntry {
  kind: "button" | "label" | "header" | "divider" | "image";
  text: string;
  icon?: string;
  onClick?: () => void;
}

/**
 * Moteur OM : un seul wrappre pour les deux types de formulaires vanilla.
 * - mode "actions" (ActionFormData) : boutons cliquables à callbacks directs ;
 * - mode "fields" (ModalFormData) : champs (texte, toggle, slider, dropdown),
 *   validés par un bouton submit unique.
 * Le mode est déterminé par le premier élément ajouté.
 */
export class OMForm {
  private readonly player: Player;
  private readonly titleText: string;
  private mode: "actions" | "fields" | "unset" = "unset";
  private readonly actions: ActionEntry[] = [];
  private readonly fieldBuilders: ((form: ModalFormData) => void)[] = [];
  private fieldReaders: ((response: ModalFormResponse) => void)[] = [];
  private readonly heroKind?: HeroKind;

  constructor(player: Player, title: string, hero?: HeroKind) {
    this.player = player;
    this.titleText = title.replace(/§./g, "").trim();
    this.heroKind = hero;
  }

  private assertActions(method: string): void {
    if (this.mode === "fields") {
      throw new Error(
        `OMForm : ${method}() impossible après un champ (ce menu est en mode ModalForm).`,
      );
    }
    this.mode = "actions";
  }

  private assertFields(method: string): void {
    if (this.mode === "actions") {
      throw new Error(
        `OMForm : ${method}() impossible après un bouton/label (ce menu est en mode ActionForm).`,
      );
    }
    this.mode = "fields";
  }

  /** Bannière de héros en tête de menu (image du RP OM dans le body). */
  hero(kind: HeroKind): OMForm {
    if (!uiDesignEnabled) return this;
    if (this.mode === "unset") this.mode = "actions";
    this.actions.push({ kind: "image", text: heroPath(kind) });
    return this;
  }

  header(text: string): OMForm {
    this.assertActions("header");
    this.actions.push({ kind: "header", text });
    return this;
  }

  label(text: string): OMForm {
    if (this.mode === "unset") this.mode = "actions";
    this.actions.push({ kind: "label", text });
    return this;
  }

  button(
    label: string,
    onClick: () => void,
    _options?: ButtonOptions,
    icon?: UIIcon,
  ): OMForm {
    this.assertActions("button");
    const flat = label.replace(/\s*\n\s*/g, "\n").trim();
    this.actions.push({
      kind: "button",
      text: flat,
      icon: icon !== undefined && uiDesignEnabled ? OM_ICON(icon) : undefined,
      onClick: () => {
        try {
          onClick();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          logMod.warn(`Action du menu « ${this.titleText} » échouée : ${message}`);
          this.player.sendMessage(
            `§c[OM] L'action du menu « ${this.titleText} » a échoué : §f${message}`,
          );
        }
      },
    });
    return this;
  }

  divider(): OMForm {
    if (this.mode === "unset") this.mode = "actions";
    if (this.mode === "actions") this.actions.push({ kind: "divider", text: "" });
    else this.fieldBuilders.push((form) => form.divider());
    return this;
  }

  spacer(): OMForm {
    return this;
  }

  toggle(label: string, initial: boolean): OMForm {
    this.assertFields("toggle");
    this.fieldBuilders.push((form) => form.toggle(label, { defaultValue: initial }));
    return this;
  }

  /** Toggle avec observable (compat menus DDUI). */
  toggleOb(label: string, observable: ObservableBoolean): OMForm {
    this.assertFields("toggle");
    this.fieldBuilders.push((form) => form.toggle(label, { defaultValue: observable.getData() }));
    this.fieldOrder.push({ kind: "toggle", ref: observable });
    this.fieldReaders.push((response) => {
      const index = this.fieldIndexOf("toggle", observable);
      const raw = response.formValues?.[index];
      if (typeof raw === "boolean") observable.setData(raw);
    });
    return this;
  }

  private fieldOrder: { kind: string; ref: unknown }[] = [];

  private fieldIndexOf(kind: string, ref: unknown): number {
    return this.fieldOrder.findIndex((entry) => entry.kind === kind && entry.ref === ref);
  }

  slider(
    label: string,
    observable: ObservableNumber,
    min: number,
    max: number,
    options?: SliderOptions,
  ): OMForm {
    this.assertFields("slider");
    const current = Math.min(Math.max(observable.getData(), min), max);
    this.fieldBuilders.push((form) =>
      form.slider(label, min, max, { valueStep: options?.step ?? 1, defaultValue: current }),
    );
    this.fieldOrder.push({ kind: "slider", ref: observable });
    this.fieldReaders.push((response) => {
      const index = this.fieldIndexOf("slider", observable);
      const raw = response.formValues?.[index];
      if (typeof raw === "number") observable.setData(raw);
    });
    return this;
  }

  dropdown(label: string, observable: ObservableNumber, items: (DropdownItemData | string)[]): OMForm {
    this.assertFields("dropdown");
    const labels = items.map((item, index) =>
      typeof item === "string" ? item : item.label || `Option ${index + 1}`,
    );
    this.fieldBuilders.push((form) =>
      form.dropdown(label, labels, { defaultValueIndex: observable.getData() }),
    );
    this.fieldOrder.push({ kind: "dropdown", ref: observable });
    this.fieldReaders.push((response) => {
      const index = this.fieldIndexOf("dropdown", observable);
      const raw = response.formValues?.[index];
      if (typeof raw === "number") observable.setData(raw);
    });
    return this;
  }

  textField(label: string, observable: ObservableString, options?: TextFieldOptions): OMForm {
    this.assertFields("textField");
    this.fieldBuilders.push((form) =>
      form.textField(label, options?.placeholder ?? "…", { defaultValue: observable.getData() }),
    );
    this.fieldOrder.push({ kind: "textField", ref: observable });
    this.fieldReaders.push((response) => {
      const index = this.fieldIndexOf("textField", observable);
      const raw = response.formValues?.[index];
      if (typeof raw === "string") observable.setData(raw);
    });
    return this;
  }

  /** Compat DDUI : bouton fermer (l'ActionForm a sa croix native). */
  closeButton(): OMForm {
    return this;
  }

  /**
   * Affiche le formulaire (différé de 2 ticks : un show() dans le même tick
   * qu'une fermeture est perdu en silence).
   */
  show(): Promise<DataDrivenScreenClosedReason> {
    return new Promise<DataDrivenScreenClosedReason>((resolve) => {
      system.runTimeout(() => {
        void this.doShow().then(resolve, (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          logMod.warn(`Menu « ${this.titleText} » : ${message}`);
          this.player.sendMessage(`§c[OM] Le menu « ${this.titleText} » n'a pas pu s'afficher : §f${message}`);
          resolve("ServerClosed");
        });
      }, 2);
    });
  }

  private async doShow(): Promise<DataDrivenScreenClosedReason> {
    if (this.mode === "fields") {
      const form = new ModalFormData().title(this.titleText);
      for (const build of this.fieldBuilders) build(form);
      const response = await form.show(this.player);
      if (response.canceled) return "UserClosed";
      for (const read of this.fieldReaders) read(response);
      return "UserClosed";
    }

    // Mode actions (défaut) : ActionFormData.
    const form = new ActionFormData().title(this.titleText);
    const bodyLines: string[] = [];
    const clickHandlers: (() => void)[] = [];

    if (this.heroKind !== undefined && uiDesignEnabled) {
      form.button("", heroPath(this.heroKind));
      clickHandlers.push(() => {
        /* la bannière est cliquable mais sans action */
      });
    }

    for (const action of this.actions) {
      if (action.kind === "image") {
        form.button("", action.text);
        clickHandlers.push(() => {
          /* bannière sans action */
        });
      } else if (action.kind === "button") {
        form.button(action.text, action.icon);
        const handler = action.onClick;
        clickHandlers.push(() => handler?.());
      } else if (action.kind === "header") {
        bodyLines.push(`§l${action.text}§r`);
      } else if (action.kind === "divider") {
        bodyLines.push("§8─────────────────────");
      } else {
        bodyLines.push(action.text);
      }
    }

    if (bodyLines.length > 0) form.body(bodyLines.join("\n"));

    const response: ActionFormResponse = await form.show(this.player);
    if (response.canceled) return "UserClosed";

    const selection = response.selection;
    if (selection !== undefined && selection >= 0 && selection < clickHandlers.length) {
      clickHandlers[selection]?.();
    }
    return "UserClosed";
  }

  isShowing(): boolean {
    return false;
  }

  closeIfShowing(): void {
    /* les forms vanilla se referment d'elles-mêmes à l'ouverture d'une autre */
  }
}

// ---------------------------------------------------------------------------
// Ouvertures normalisées (mêmes signatures que l'ancien moteur)
// ---------------------------------------------------------------------------

/**
 * Construit et affiche une fenêtre OM ; rapporte les erreurs EN JEU.
 */
function buildAndShow(
  player: Player,
  title: string,
  build: (form: OMForm) => void,
  hero?: HeroKind,
): Promise<DataDrivenScreenClosedReason> {
  const shortName = title.replace(/§./g, "").trim();
  return new Promise<DataDrivenScreenClosedReason>((resolve, reject) => {
    system.runTimeout(() => {
      let form: OMForm;
      try {
        form = new OMForm(player, title, hero);
        build(form);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logMod.warn(`Menu « ${shortName} » n'a pas pu se construire : ${message}`);
        player.sendMessage(`§c[OM] Le menu « ${shortName} » n'a pas pu se construire : §f${message}`);
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      form.show().then(resolve, (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logMod.warn(`Menu « ${shortName} » n'a pas pu s'afficher : ${message}`);
        player.sendMessage(`§c[OM] Le menu « ${shortName} » n'a pas pu s'afficher : §f${message}`);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    }, 2);
  });
}

/**
 * Ouvre une fenêtre OM avec titre normalisé, héros et gestion d'erreur en jeu.
 */
export function openWindow(
  player: Player,
  section: string,
  build: (form: OMForm) => void,
  hero?: HeroKind,
): Promise<DataDrivenScreenClosedReason> {
  return buildAndShow(player, windowTitle(section), build, hero);
}

/** Fenêtre avec titre brut (menus secondaires, confirmations…). */
export function openWindowRaw(
  player: Player,
  title: string,
  build: (form: OMForm) => void,
): Promise<DataDrivenScreenClosedReason> {
  return buildAndShow(player, title, build);
}

/** Ferme l'écran ouvert pour ce joueur (compat : les forms vanilla se gèrent seules). */
export function closeOpenForm(_player: Player): void {
  /* no-op sur les forms vanilla */
}

/** Type de réponse MessageForm (compat imports). */
export type { MessageFormResponse };
