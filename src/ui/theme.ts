/**
 * Moteur UI NaLandia — TRANSPORT INVISIBLE + JSON UI À NOUS (v3.1).
 *
 * Architecture (décision produit du 2026-09-19) :
 *   - Le TRANSPORT est l'API native `@minecraft/server-ui`. C'est le seul
 *     pont d'écran que Bedrock expose au script : il porte les données et les
 *     clics, il n'est jamais visible.
 *       · menus à tuiles → `ActionFormData` (liste verticale de boutons) ;
 *       · fiches/écrans à champs → `CustomForm` (champs natifs : la qualité
 *         d'input texte/slider/dropdown est garantie par Mojang).
 *   - L'APPARENCE vient de `RP/ui/server_form.json` — NOTRE fichier, généré
 *     par `scripts/build_server_form.py` (vanilla 1.26.50 + dalles om_btn,
 *     titre doré, fenêtres élargies). Le script n'envoie JAMAIS de texture :
 *     il envoie du texte, le RP habille.
 *
 * Plus aucun framework JSX (@bedrock-core), plus de render pack, plus de
 * routage par titre côté script : un seul thème signature, porté par le RP.
 */
import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import {
  ActionFormData,
  CustomForm as NativeCustomForm,
  ObservableBoolean as NativeObservableBoolean,
  ObservableNumber as NativeObservableNumber,
  ObservableString as NativeObservableString,
} from "@minecraft/server-ui";
import type {
  ActionFormResponse,
  ModalFormData,
  MessageFormResponse,
} from "@minecraft/server-ui";
import { logMod } from "../lib/log";
import { PANEL_TILE_CAPACITY, pageSlice } from "./labels";

export const RP_PACK_ID = "33ca6e1c-4f30-46ae-8b56-1510382e3f61";

export const THEME = { primary: "§a", accent: "§6", danger: "§c", muted: "§7" } as const;
export type UIIcon = string;
export type HeroKind = string;

export * from "./labels";

/** Titre normalisé d'une section — conservé pour la compat des call sites. */
export function windowTitle(section: string): string {
  return section;
}

/**
 * Interrupteur d'habillage conservé pour /sn:config : avec l'architecture
 * « transport invisible », l'habillage JSON UI ne peut plus être coupé par
 * le script (il vit dans le RP). L'option reste sans effet et sans erreur.
 */
let uiDesignEnabled = true;
export function setUiDesign(_enabled: boolean): void {
  uiDesignEnabled = _enabled;
}
export function isUiDesignEnabled(): boolean {
  return uiDesignEnabled;
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
// OMForm — formulaires à champs (CustomForm natif) et fiches de lecture.
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

/**
 * Nettoyage des décorations ASCII héritées des anciens designs : le JSON UI
 * maison les rendait jolies, le rendu natif les affiche telles quelles —
 * on retire les blocs/bordures qui n'ont plus de sens (les codes § sont
 * conservés : le jeu les colore nativement).
 */
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
  return buildAndShow(player, section, build).catch((error: unknown) => {
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
export type NativeFormData = ActionFormResponse | ModalFormData | MessageFormResponse;

// ---------------------------------------------------------------------------
// MENUS À TUILES — ActionFormData, transport invisible.
//
// `menu.action(key, label, onClick)` suit l'API historique. Les menus
// DYNAMIQUES (paginés) basculent automatiquement en pagination par pages de
// PANEL_TILE_CAPACITY entrées : la colonne native n'affiche de toute façon
// qu'une liste scrollable, on garde le découpage pour préserver les repères.
// ---------------------------------------------------------------------------

export interface TileMenuBuilder {
  /** Tuile cliquable. */
  action(key: string, label: string, onClick: () => void): TileMenuBuilder;
  /** Plaque latérale (ancien design) : conservé pour la compat call sites. */
  data(key: string, text: string): TileMenuBuilder;
  /** Texte d'en-tête du menu, affiché comme premier libellé. */
  body(text: string): TileMenuBuilder;
}

interface TileAction {
  label: string;
  onClick: () => void;
}

/**
 * Ouvre un menu à tuiles via le transport natif. L'API builder est identique
 * à l'ancien moteur : les call sites ne changent pas.
 *
 * Les listes longues sont automatiquement paginées (‹ Page précédente /
 * Page suivante ›) pour rester lisibles dans la colonne native.
 */
export function openTileMenu(
  player: Player,
  section: string,
  build: (menu: TileMenuBuilder) => void,
): void {
  const ordered: TileAction[] = [];
  let bodyText = "";

  const builder: TileMenuBuilder = {
    action(_key, label, onClick) {
      ordered.push({ label, onClick });
      return builder;
    },
    data(_key, _text) {
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

  // Un petit délai : l'ouverture d'un écran juste après la fermeture du
  // précédent peut être refusée par le client (UserBusy).
  system.runTimeout(() => {
    try {
      const isLongList = ordered.length > PANEL_TILE_CAPACITY;
      if (isLongList) {
        openPagedList(player, section, bodyText, ordered);
      } else {
        showActionMenu(player, section, bodyText, ordered);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logMod.warn(`Menu « ${section} » : ${message}`);
      player.sendMessage(`§c[NaLandia] Le menu « ${section} » n'a pas pu s'afficher : §f${message}`);
    }
  }, 1);
}

/**
 * Liste étendue : pagination automatique par PANEL_TILE_CAPACITY entrées.
 * Les deux tuiles de navigation restent visibles en fin de colonne ; désactivées
 * (§8, action vide) quand la page correspondante n'existe pas.
 */
function openPagedList(
  player: Player,
  section: string,
  bodyText: string,
  ordered: TileAction[],
): void {
  let page = 0;
  const showPage = (): void => {
    const { items, page: current, pageCount } = pageSlice(ordered, page, PANEL_TILE_CAPACITY);
    const nav: TileAction[] = [
      ...items,
      {
        label: current > 0 ? "§7‹ Page précédente" : "§8—",
        onClick: () => {
          if (page > 0) {
            page--;
            showPage();
          }
        },
      },
      {
        label: current < pageCount - 1 ? "§7Page suivante ›" : "§8—",
        onClick: () => {
          if (page < pageCount - 1) {
            page++;
            showPage();
          }
        },
      },
    ];
    showActionMenu(player, section, bodyText, nav);
  };
  showPage();
}

/** Presente la liste dans un ActionFormData avec retry UserBusy. */
function showActionMenu(
  player: Player,
  section: string,
  bodyText: string,
  ordered: TileAction[],
): void {
  const title = section.replace(/§./g, "").trim();
  const present = (attempt: number): void => {
    system.runTimeout(() => {
      void (async () => {
        try {
          const form = new ActionFormData();
          form.title(title);
          if (bodyText.trim().length > 0) form.body(clean(bodyText));
          for (const action of ordered) form.button(action.label);
          const response = await form.show(player);
          if (response.cancelationReason === "UserBusy" && attempt < 4) {
            present(attempt + 1);
            return;
          }
          if (response.cancelationReason === "UserClosed" || response.selection === undefined) return;
          // Fermer avant d'ouvrir le suivant (sinon l'écran précédent reste).
          const action = ordered[response.selection];
          action?.onClick();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          if (attempt < 4) {
            logMod.warn(`Menu « ${title} » : ${message} (nouvel essai)`);
            present(attempt + 1);
            return;
          }
          logMod.warn(`Menu « ${title} » : ${message}`);
          player.sendMessage(`§c[NaLandia] Le menu « ${title} » n'a pas pu s'afficher : §f${message}`);
        }
      })();
    }, attempt === 0 ? 1 : 10);
  };
  present(0);
}
