/**
 * Thème graphique commun à toutes les GUI OpenMontage.
 *
 * MOTEUR (v13.1) : formulaires VANILLA stables de @minecraft/server-ui :
 * - ActionFormData : menus à boutons (icônes du RP, labels multi-lignes,
 *   codes § rendus nativement) ;
 * - ModalFormData : formulaires à champs (switchs, sliders, dropdowns,
 *   champs texte) — avec header/label/divider/submitButton natifs.
 *
 * ROUTAGE (le point qui a cassé /sn:create en v13.0) : un form vanilla est
 * SOIT une liste de boutons, SOIT un formulaire de champs. Les éléments
 * NEUTRES (header, label, divider) sont légaux des deux côtés — ils ne
 * verrouillent PLUS le mode. Le mode est fixé par le premier élément fort :
 * button() → mode actions ; textField/toggle/slider/dropdown() → mode fields.
 * En mode fields, le DERNIER bouton devient le bouton submit natif
 * (son callback part à la validation) — c'est le schéma de /sn:create.
 *
 * Le DDUI (CustomForm bêta) est ABANDONNÉ. Les forms vanilla sont rendues
 * par notre reskin JSON UI (RP/ui/server_form.json) : habillage bleu nuit.
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

/**
 * Éléments d'un menu OM. Neutres (header/label/divider) : légaux dans les
 * deux modes. Forts : button (actions / submit) et field (ModalForm).
 */
type FormElement =
  | { kind: "header" | "label" | "divider"; text: string }
  | { kind: "image"; texture: string }
  | { kind: "button"; text: string; icon?: string; onClick: () => void }
  | {
      kind: "field";
      build: (form: ModalFormData) => void;
      read: (response: ModalFormResponse, index: number) => void;
    };

/**
 * Moteur OM : un seul wrapper pour les deux types de formulaires vanilla.
 * Voir l'en-tête du fichier pour les règles de routage (v13.1).
 */
export class OMForm {
  private readonly player: Player;
  private readonly titleText: string;
  private mode: "actions" | "fields" | "unset" = "unset";
  private readonly elements: FormElement[] = [];
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

  /**
   * Bascule en mode champs. Les boutons/images posés AVANT le premier champ
   * ne sont pas reproductibles dans un ModalForm : ils sont retirés (avec
   * avertissement) — le DERNIER bouton d'un menu fields devient le submit.
   */
  private enterFields(): void {
    if (this.mode === "actions") {
      const kept = this.elements.filter(
        (el) => el.kind !== "button" && el.kind !== "image",
      );
      const dropped =
        this.elements.length - kept.length;
      if (dropped > 0) {
        logMod.warn(
          `Menu « ${this.titleText} » : ${dropped} bouton(s)/image(s) posé(s) avant le premier champ ignorés (ModalForm).`,
        );
      }
      this.elements.length = 0;
      this.elements.push(...kept);
    }
    this.mode = "fields";
  }

  /** Bannière de héros en tête de menu (image du RP OM dans le body). */
  hero(kind: HeroKind): OMForm {
    if (!uiDesignEnabled) return this;
    this.elements.push({ kind: "image", texture: heroPath(kind) });
    return this;
  }

  header(text: string): OMForm {
    this.elements.push({ kind: "header", text });
    return this;
  }

  label(text: string): OMForm {
    this.elements.push({ kind: "label", text });
    return this;
  }

  button(
    label: string,
    onClick: () => void,
    _options?: ButtonOptions,
    icon?: UIIcon,
  ): OMForm {
    const flat = label.replace(/\s*\n\s*/g, "\n").trim();
    const wrapped = (): void => {
      try {
        onClick();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logMod.warn(`Action du menu « ${this.titleText} » échouée : ${message}`);
        this.player.sendMessage(
          `§c[OM] L'action du menu « ${this.titleText} » a échoué : §f${message}`,
        );
      }
    };
    if (this.mode === "fields") {
      // Bouton après un champ : devient le bouton submit natif (le dernier gagne).
      this.elements.push({ kind: "button", text: flat, onClick: wrapped });
      return this;
    }
    this.assertActions("button");
    this.elements.push({
      kind: "button",
      text: flat,
      icon: icon !== undefined && uiDesignEnabled ? OM_ICON(icon) : undefined,
      onClick: wrapped,
    });
    return this;
  }

  divider(): OMForm {
    this.elements.push({ kind: "divider", text: "" });
    return this;
  }

  spacer(): OMForm {
    return this;
  }

  toggle(label: string, initial: boolean): OMForm {
    this.enterFields();
    this.elements.push({
      kind: "field",
      build: (form) => form.toggle(label, { defaultValue: initial }),
      read: (response, index) => {
        void response.formValues?.[index];
      },
    });
    return this;
  }

  /** Toggle avec observable (compat menus DDUI). */
  toggleOb(label: string, observable: ObservableBoolean): OMForm {
    this.enterFields();
    this.elements.push({
      kind: "field",
      build: (form) => form.toggle(label, { defaultValue: observable.getData() }),
      read: (response, index) => {
        const raw = response.formValues?.[index];
        if (typeof raw === "boolean") observable.setData(raw);
      },
    });
    return this;
  }

  slider(
    label: string,
    observable: ObservableNumber,
    min: number,
    max: number,
    options?: SliderOptions,
  ): OMForm {
    this.enterFields();
    const current = Math.min(Math.max(observable.getData(), min), max);
    this.elements.push({
      kind: "field",
      build: (form) =>
        form.slider(label, min, max, { valueStep: options?.step ?? 1, defaultValue: current }),
      read: (response, index) => {
        const raw = response.formValues?.[index];
        if (typeof raw === "number") observable.setData(raw);
      },
    });
    return this;
  }

  dropdown(label: string, observable: ObservableNumber, items: (DropdownItemData | string)[]): OMForm {
    this.enterFields();
    const labels = items.map((item, index) =>
      typeof item === "string" ? item : item.label || `Option ${index + 1}`,
    );
    this.elements.push({
      kind: "field",
      build: (form) =>
        form.dropdown(label, labels, { defaultValueIndex: observable.getData() }),
      read: (response, index) => {
        const raw = response.formValues?.[index];
        if (typeof raw === "number") observable.setData(raw);
      },
    });
    return this;
  }

  textField(label: string, observable: ObservableString, options?: TextFieldOptions): OMForm {
    this.enterFields();
    this.elements.push({
      kind: "field",
      build: (form) =>
        form.textField(label, options?.placeholder ?? "…", { defaultValue: observable.getData() }),
      read: (response, index) => {
        const raw = response.formValues?.[index];
        if (typeof raw === "string") observable.setData(raw);
      },
    });
    return this;
  }

  /** Compat DDUI : bouton fermer (les forms vanilla ont leur croix native). */
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
          this.player.sendMessage(
            `§c[OM] Le menu « ${this.titleText} » n'a pas pu s'afficher : §f${message}`,
          );
          resolve("ServerClosed");
        });
      }, 2);
    });
  }

  private async doShow(): Promise<DataDrivenScreenClosedReason> {
    if (this.mode === "fields") return this.showFields();
    return this.showActions();
  }

  /** Mode champs : ModalFormData (header/label/divider natifs + submit). */
  private async showFields(): Promise<DataDrivenScreenClosedReason> {
    const form = new ModalFormData().title(this.titleText);

    // Le DERNIER bouton posé est le submit ; les intermédiaires sont ignorés.
    const lastButtonIndex = this.elements.reduce(
      (last, el, index) => (el.kind === "button" ? index : last),
      -1,
    );
    let submitAction: (() => void) | undefined;

    for (const [index, el] of this.elements.entries()) {
      switch (el.kind) {
        case "header":
          form.header(el.text);
          break;
        case "label":
          form.label(el.text);
          break;
        case "divider":
          form.divider();
          break;
        case "image":
          break; // pas d'images dans un ModalForm
        case "button":
          if (index === lastButtonIndex) {
            form.submitButton(el.text);
            submitAction = el.onClick;
          } else {
            logMod.warn(
              `Menu « ${this.titleText} » : bouton intermédiaire ignoré (un seul submit possible).`,
            );
          }
          break;
        case "field":
          el.build(form);
          break;
      }
    }

    const response = await form.show(this.player);
    if (response.canceled) return "UserClosed";

    // Second passage : lecture des valeurs (indices comptés ci-dessus).
    let readIndex = 0;
    for (const el of this.elements) {
      if (el.kind === "field") {
        el.read(response, readIndex);
        readIndex += 1;
      }
    }
    submitAction?.();
    return "UserClosed";
  }

  /** Mode actions : ActionFormData (boutons à callbacks, icônes, body §). */
  private async showActions(): Promise<DataDrivenScreenClosedReason> {
    const form = new ActionFormData().title(this.titleText);
    const bodyLines: string[] = [];
    const clickHandlers: (() => void)[] = [];

    if (this.heroKind !== undefined && uiDesignEnabled) {
      form.button("", heroPath(this.heroKind));
      clickHandlers.push(() => {
        /* la bannière est cliquable mais sans action */
      });
    }

    for (const action of this.elements) {
      if (action.kind === "image") {
        form.button("", action.texture);
        clickHandlers.push(() => {
          /* bannière sans action */
        });
      } else if (action.kind === "button") {
        form.button(action.text, action.icon);
        clickHandlers.push(action.onClick);
      } else if (action.kind === "header") {
        bodyLines.push(`§l${action.text}§r`);
      } else if (action.kind === "divider") {
        bodyLines.push("§8─────────────────────");
      } else if (action.kind === "label") {
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
