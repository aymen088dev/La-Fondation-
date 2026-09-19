/**
 * Moteur UI NaLandia — @bedrock-core/ui (JSX) pour les MENUS, formulaires
 * NATIFS pour les champs.
 *
 *  - `openTileMenu` : menus à tuiles. Le builder (`menu.action/data/body`)
 *    construit un arbre de composants rendu par le framework : layout libre
 *    (flexbox), scroll natif, textures om_*, tactile/manette/clavier gérés
 *    par le render pack CoreUI (vendu dans RP/ui/core-ui).
 *  - `OMForm` : formulaires à champs (`CustomForm` natif). L'input texte,
 *    slider, dropdown restent natifs : qualité d'input garantie par Mojang.
 *
 * Dégradation gracieuse : si le render pack est absent, le framework affiche
 * son habillage « unstyled » — tout reste lisible et cliquable.
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
import { render, Text } from "@bedrock-core/ui";
import { logMod } from "../lib/log";
import { SidebarLayout, TileButton, ScrollList } from "./kit";
import { PANEL_TILE_CAPACITY, fitLabel } from "./labels";

export const RP_PACK_ID = "33ca6e1c-4f30-46ae-8b56-1510382e3f61";

export const THEME = { primary: "§a", accent: "§6", danger: "§c", muted: "§7" } as const;
export type UIIcon = string;
export type HeroKind = string;

export * from "./labels";

/** Titre normalisé d'une section — conservé pour la compat des call sites. */
export function windowTitle(section: string): string {
  return section;
}

/** Interrupteur global d'habillage (conservé pour /sn:config côté main). */
let uiDesignEnabled = true;
export function setUiDesign(enabled: boolean): void {
  uiDesignEnabled = enabled;
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
          form.image(element.path, "33ca6e1c-4f30-46ae-8b56-1510382e3f61", { width: element.width });
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
export type NativeFormData = ActionFormData | ModalFormData | CustomForm;

// ---------------------------------------------------------------------------
// MENUS À TUILES — rendus par @bedrock-core/ui (JSX + render pack CoreUI).
// ---------------------------------------------------------------------------

export interface TileMenuBuilder {
  /** Tuile cliquable. */
  action(key: string, label: string, onClick: () => void): TileMenuBuilder;
  /** Texte affiché dans la plaque latérale du panneau. */
  data(key: string, text: string): TileMenuBuilder;
  /** Texte affiché dans la plaque latérale du panneau. */
  body(text: string): TileMenuBuilder;
}

interface TileAction {
  label: string;
  onClick: () => void;
}

interface TileScreenProps {
  title: string;
  bodyText: string;
  ordered: TileAction[];
  capacity: number;
}

/** Écran générique : colonne de tuiles à gauche, plaque de texte à droite. */
function TileScreen({ title, bodyText, ordered, capacity }: TileScreenProps) {
  const visible = ordered.slice(0, capacity);
  return (
    <SidebarLayout
      title={title}
      nav={visible.map((action) => (
        <TileButton
          label={fitLabel(action.label, 24)}
          width="100%"
          onPress={action.onClick}
        />
      ))}
      content={<BodyText text={bodyText} />}
    />
  );
}

/** Liste étendue : TOUTE la liste est scrollable (plus de pagination forcée). */
function ListScreen(props: { title: string; bodyText: string; ordered: TileAction[] }) {
  return (
    <SidebarLayout
      title={props.title}
      nav={
        <ScrollList
          width="100%"
          items={props.ordered.map((action) => ({
            label: fitLabel(action.label, 24),
            onPress: action.onClick,
          }))}
        />
      }
      content={<BodyText text={props.bodyText} />}
    />
  );
}

/** La plaque de droite : texte multi-ligne (les \n deviennent des <Text>). */
function BodyText(props: { text: string }) {
  const lines = props.text.length > 0 ? props.text.split("\n") : [];
  return (
    <>
      {lines.map((line) => (
        <Text>{line}</Text>
      ))}
    </>
  );
}

/**
 * Ouvre un menu à tuiles rendu par le framework. L'API builder est identique
 * à l'ancien moteur : les call sites ne changent pas.
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
  // précédent peut être refusée par le client (UserBusy côté framework).
  system.runTimeout(() => {
    try {
      const isLongList = ordered.length > PANEL_TILE_CAPACITY;
      if (isLongList) {
        render(
          <ListScreen title={section} bodyText={bodyText} ordered={ordered} />,
          player,
        );
      } else {
        render(
          <TileScreen
            title={section}
            bodyText={bodyText}
            ordered={ordered}
            capacity={PANEL_TILE_CAPACITY}
          />,
          player,
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logMod.warn(`Menu « ${section} » : ${message}`);
      player.sendMessage(`§c[NaLandia] Le menu « ${section} » n'a pas pu s'afficher : §f${message}`);
    }
  }, 1);
}
