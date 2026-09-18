/**
 * Thème graphique et moteur de menus NaLandia (v20).
 *
 * ⚠️ CHANGEMENT D'ARCHITECTURE MAJEUR — le reskin JSON UI maison est remplacé
 * par le runtime **@bedrock-core/ui** :
 *
 *  - les menus sont décrits en **JSX** (composants `ActionsScreen` / `FieldsScreen`) ;
 *  - le runtime **sérialise** l'arbre dans la chaîne que porte un formulaire
 *    vanilla (`ActionFormData` ou, si l'arbre contient un `<Form>`,
 *    `ModalFormData`) ;
 *  - le **render pack** JSON UI (fusionné dans notre Resource Pack, cf.
 *    `RP/ui/core-ui/`) décode cette chaîne et peint l'écran.
 *
 * POURQUOI CE CHANGEMENT : Bedrock n'expose QU'UN seul écran pour tous les menus
 * à boutons (`long_form`). L'ancienne approche devinait la famille du menu en
 * comparant son TITRE dans le JSON UI — fragile, et limitée à deux silhouettes
 * très proches. Ici la mise en page est **choisie par notre propre code**
 * (`designForSection`, voir ./sheets), donc chaque famille a réellement sa
 * propre silhouette :
 *
 *  - `console`   → barre de titre + colonne de tuiles fines (hub, admin, DB…) ;
 *  - `cards`     → grand bandeau doré + grandes cartes empilées, fond émeraude ;
 *  - `parchment` → bandeau doré + panneau de texte, fond bleu nuit ;
 *  - `fields`    → formulaire à champs (`<Form>`), bandeau + champs natifs.
 *
 * L'API publique du moteur (`OMForm`, `openWindow`, `openWindowRaw`, les
 * observables…) est CONSERVÉE à l'identique : les menus du projet n'ont pas à
 * changer.
 */

import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import type { MessageFormResponse } from "@minecraft/server-ui";
import {
  Background,
  Button,
  Form,
  Panel,
  Scroll,
  Text,
  render,
  useEffect,
  useExit,
  type JSX,
} from "@bedrock-core/ui";
import { logMod } from "../lib/log";
import {
  BUTTON_BACK_MARKER,
  DESIGN_SPECS,
  DIVIDER_TEXTURE,
  designForSection,
  designForTitle,
  PANE_TEXTURE,
  sheetTitleFor,
  TITLE_PREFIX,
  type ScreenDesign,
} from "./sheets";

/** Identifiant du Resource Pack NaLandia (conservé pour les appelants). */
export const RP_PACK_ID = "33ca6e1c-4f30-46ae-8b56-1510382e3f61";

/** Palette du thème (codes § — rendus nativement par les labels). */
export const THEME = {
  primary: "§a",
  accent: "§6",
  danger: "§c",
  muted: "§7",
} as const;

/** Chemin d'icône d'un bouton. Seul le bouton retour en porte une. */
export type UIIcon = string;

/* Contrat de style (flèche retour, familles visuelles) — ré-exporté. */
export * from "./sheets";

/** Bannières de héros — désactivées : conservé pour la compat des signatures. */
export type HeroKind = string;

let uiDesignEnabled = true;

/** Active/désactive le design image. */
export function setUiDesign(enabled: boolean): void {
  uiDesignEnabled = enabled;
}

/** État actuel du design image. */
export function isUiDesignEnabled(): boolean {
  return uiDesignEnabled;
}

/** Conservé (plus utilisé : plus aucune comparaison de titre côté JSON UI). */
export const UI_TITLE_TAG = "";

/**
 * Sanitiseur de texte : retire les puces décoratives (■ ≡ ⬥ ✦ — elles rendent
 * en carrés abscons sur la police Bedrock) et les marqueurs internes §h.
 */
function plain(text: string): string {
  return text.replace(/§h/g, "").replace(/[■≡⬥✦]\s?/g, "").trim();
}

/** Construit un titre de fenêtre normalisé : "NaLandia » <title>". */
export function windowTitle(section: string): string {
  return `${TITLE_PREFIX}${section}`;
}

/* Habillages des familles : source de vérité dans ./sheets (testable). */
const DESIGNS = DESIGN_SPECS;

/* ---------------------------------------------------------------------------
 * Observables (shims de compatibilité : la valeur est lue au submit).
 * ------------------------------------------------------------------------- */

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

export function obString(initial: string): ObservableString {
  return new ObservableString(initial);
}
export function obNumber(initial: number): ObservableNumber {
  return new ObservableNumber(initial);
}
export function obBool(initial: boolean): ObservableBoolean {
  return new ObservableBoolean(initial);
}
export function obToggle(initial: boolean, onChange: (value: boolean) => void): ObservableBoolean {
  const observable = new ObservableBoolean(initial);
  observable.subscribe(onChange);
  return observable;
}

/* ---------------------------------------------------------------------------
 * Types du moteur
 * ------------------------------------------------------------------------- */

/** État de fermeture d'un écran (compat). */
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

type FieldElement = {
  kind: "field";
  /** Nom du champ côté `Form.onSubmit`. */
  name: string;
  /** Déclaration JSX du champ. */
  render: () => JSX.Element;
  /** Lecture de la valeur au submit. */
  read: (value: unknown) => void;
};

type FormElement =
  | { kind: "header" | "label" | "divider" | "body"; text: string }
  | { kind: "button"; text: string; onClick: () => void }
  | FieldElement;

/* ---------------------------------------------------------------------------
 * Composants JSX du moteur
 * ------------------------------------------------------------------------- */

/** Texture de la croix de fermeture (Ore UI). */
const CLOSE_TEXTURE = "textures/ui/ore-styled/button/close/background";
const CLOSE_HOVER = "textures/ui/ore-styled/button/close/background_hover";
const CLOSE_PRESS = "textures/ui/ore-styled/button/close/background_pressed";

/**
 * Bouton retour : vraie pastille-flèche 22×22 en haut à gauche du bandeau.
 */
function BackArrow({ onBack }: { onBack: () => void }): JSX.Element {
  return (
    <Button
      width={22}
      height={22}
      background={"textures/ui/om_btn_back"}
      backgroundHover={"textures/ui/om_btn_back_hover"}
      backgroundPressed={"textures/ui/om_btn_back_hover"}
      onPress={onBack}
    />
  );
}

/**
 * Croix de fermeture (22×22, en haut à droite du bandeau) — remet la croix
 * native des menus Bedrock qui disparaissait derrière le render pack.
 */
function CloseCross({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <Button
      width={22}
      height={22}
      background={CLOSE_TEXTURE}
      backgroundHover={CLOSE_HOVER}
      backgroundPressed={CLOSE_PRESS}
      onPress={onClose}
    />
  );
}

/**
 * Bandeau de titre (or) : flèche retour à GAUCHE, croix de fermeture à DROITE.
 * Le nom de la section seul est affiché (l'écran canonique ne fait que
 * 320×210 px — le préfixe « NaLandia » débordait).
 */
function Banner({
  design,
  title,
  onBack,
  onClose,
}: {
  design: ScreenDesign;
  title: string;
  onBack?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
}): JSX.Element {
  const spec = DESIGNS[design];
  const section = title.startsWith(TITLE_PREFIX) ? title.slice(TITLE_PREFIX.length) : title;
  return (
    <Panel
      width={"100%"}
      flexDirection={"row"}
      alignItems={"center"}
      gap={6}
      padding={6}
      background={spec.banner}
    >
      {onBack ? <BackArrow onBack={onBack} /> : <Panel width={22} height={22} />}
      <Panel width={"100%"} flexDirection={"row"} justifyContent={"center"} alignItems={"center"}>
        <Text scale={spec.titleScale} maxLines={1} overflow={"ellipsis"} shadow={true}>
          {`§l§6${section}`}
        </Text>
      </Panel>
      {onClose ? <CloseCross onClose={onClose} /> : <Panel width={22} height={22} />}
    </Panel>
  );
}

/** Accent doré fin (petite ligne lumineuse sous un en-tête). */
function AccentLine(): JSX.Element {
  return <Panel width={24} height={2} background={"textures/ui/om_header_band"} marginTop={1} />;
}

/** En-tête de section : or, gras + filet d'accent sous le texte. */
function GroupHeader({ text, scale }: { text: string; scale: number }): JSX.Element {
  return (
    <Panel width={"100%"} flexDirection={"column"} gap={1} marginTop={3}>
      <Text scale={scale} shadow={true}>{`§l§6${text}`}</Text>
      <AccentLine />
    </Panel>
  );
}

/**
 * Entrée « console » : tuile fine à marqueur doré vertical à gauche, façon
 * liste de console. Le survol allume la tuile entière.
 */
function ConsoleRow({ label, onPress }: { label: string; onPress: () => void }): JSX.Element {
  const spec = DESIGNS.console;
  return (
    <Button
      width={"100%"}
      height={spec.rowHeight}
      background={spec.row}
      backgroundHover={spec.rowHover}
      backgroundPressed={spec.rowPress}
      onPress={onPress}
    >
      <Panel
        width={"100%"}
        height={"100%"}
        flexDirection={"row"}
        alignItems={"center"}
        paddingLeft={6}
        paddingRight={8}
      >
        <Panel width={2} height={"60%"} background={"textures/ui/om_header_band"} marginRight={6} />
        <Text scale={spec.scale} maxLines={1} overflow={"ellipsis"} shadow={true}>
          {label}
        </Text>
      </Panel>
    </Button>
  );
}

/**
 * Grande carte « contenu » : liseré doré à gauche (4 px), libellé plus gros et
 * chevron doré en bout — une pile de plaques, sans rapport avec la console.
 */
function CardRow({ label, onPress }: { label: string; onPress: () => void }): JSX.Element {
  const spec = DESIGNS.cards;
  return (
    <Button
      width={"100%"}
      height={spec.rowHeight}
      background={spec.row}
      backgroundHover={spec.rowHover}
      backgroundPressed={spec.rowPress}
      onPress={onPress}
    >
      <Panel
        width={"100%"}
        height={"100%"}
        flexDirection={"row"}
        alignItems={"center"}
        paddingLeft={4}
        paddingRight={10}
      >
        <Panel width={4} height={"100%"} background={"textures/ui/om_header_band"} marginRight={8} />
        <Text scale={spec.scale} maxLines={1} overflow={"ellipsis"} shadow={true}>
          {label}
        </Text>
        <Panel flexGrow={1} />
        <Panel width={3} height={"55%"} background={"textures/ui/om_header_band"} marginLeft={2} />
      </Panel>
    </Button>
  );
}

/**
 * Tuile « parchemin » : bouton Ore UI (bleu acier) + chevron gris en bout —
 * la fiche se lit comme un registre.
 */
function ParchmentRow({ label, onPress }: { label: string; onPress: () => void }): JSX.Element {
  const spec = DESIGNS.parchment;
  return (
    <Button
      width={"100%"}
      height={spec.rowHeight}
      background={spec.row}
      backgroundHover={spec.rowHover}
      backgroundPressed={spec.rowPress}
      onPress={onPress}
    >
      <Panel
        width={"100%"}
        height={"100%"}
        flexDirection={"row"}
        alignItems={"center"}
        paddingLeft={8}
        paddingRight={8}
      >
        <Text scale={spec.scale} maxLines={1} overflow={"ellipsis"} shadow={true}>
          {label}
        </Text>
        <Panel flexGrow={1} />
        <Panel width={3} height={"55%"} background={"textures/ui/om_header_band"} marginLeft={2} />
      </Panel>
    </Button>
  );
}

/** Entrée cliquable : délègue à la tuile de sa famille. */
function Row({
  design,
  label,
  onPress,
}: {
  design: ScreenDesign;
  label: string;
  onPress: () => void;
}): JSX.Element {
  if (design === "cards") return <CardRow label={label} onPress={onPress} />;
  if (design === "parchment") return <ParchmentRow label={label} onPress={onPress} />;
  return <ConsoleRow label={label} onPress={onPress} />;
}

/** Filet or/argent. */
function Sep(): JSX.Element {
  return (
    <Panel width={"100%"} height={6} background={DIVIDER_TEXTURE} marginTop={2} marginBottom={2} />
  );
}

/* ---------------------------------------------------------------------------
 * Rendu d'un écran
 * ------------------------------------------------------------------------- */

interface RootProps {
  design: ScreenDesign;
  title: string;
  onBack: (() => void) | undefined;
  elements: FormElement[];
  onClose: () => void;
  onAction: (onClick: () => void) => void;
  onFieldSubmit: (values: Record<string, unknown>) => void;
  onFieldCancel: () => void;
}

/** Résout la promesse de `show()` quand l'écran est démonté (fermé). */
function useCloseOnUnmount(onClose: () => void): void {
  useEffect(() => {
    return (): void => onClose();
  }, []);
}

function ActionsScreen(props: RootProps): JSX.Element {
  const spec = DESIGNS[props.design];
  useCloseOnUnmount(props.onClose);
  /*
   * VERDICT DU FRAMEWORK : après un clic, `runInteractiveCallback` ne rend
   * `'cleanup'` (démontage réel) QUE si une fibre a demandé sa fermeture via
   * `exit()`. Sans ça, le runtime RE-PRÉSENTE le formulaire : le menu clignote
   * puis revient (le fameux « je clique, rien ne se passe, le menu revient »).
   * Chaque interaction (action, croix, retour) appelle donc exit() DANS la
   * transaction du clic.
   */
  const exit = useExit();

  const content: JSX.Element[] = [];
  for (const el of props.elements) {
    switch (el.kind) {
      case "header":
        content.push(<GroupHeader text={el.text} scale={spec.scale * 1.1} />);
        break;
      case "label":
        content.push(<Text>{`§7${el.text}`}</Text>);
        break;
      case "body":
        content.push(<Text>{`§f${el.text}`}</Text>);
        break;
      case "divider":
        content.push(<Sep />);
        break;
      case "button": {
        if (el.text === BUTTON_BACK_MARKER) break;
        const onClick = el.onClick;
        content.push(
          <Row
            design={props.design}
            label={el.text}
            onPress={(): void => {
              props.onAction(onClick);
              exit();
            }}
          />,
        );
        break;
      }
      case "field":
        break;
    }
  }

  return (
    <Panel width={"100%"} height={"100%"} flexDirection={"column"} padding={4} gap={3}>
      <Background texture={spec.bg} />
      <Banner
        design={props.design}
        title={props.title}
        onBack={
          props.onBack
            ? (): void => {
                props.onBack?.();
                exit();
              }
            : undefined
        }
        onClose={(): void => exit()}
      />
      <Scroll flexGrow={1}>
        <Panel width={"100%"} flexDirection={"column"} gap={spec.rowGap} padding={2}>
          {content}
        </Panel>
      </Scroll>
    </Panel>
  );
}

function FieldsScreen(props: RootProps): JSX.Element {
  const spec = DESIGNS.parchment;
  useCloseOnUnmount(props.onClose);
  /* Même verdict que l'écran d'actions : submit/cancel doivent démonter. */
  const exit = useExit();

  const headerNodes: JSX.Element[] = [];
  const fieldNodes: JSX.Element[] = [];
  let submitLabel = "Valider";
  for (const el of props.elements) {
    if (el.kind === "field") {
      fieldNodes.push(<Panel width={"100%"}>{el.render()}</Panel>);
    } else if (el.kind === "button") {
      submitLabel = el.text; // le DERNIER bouton est le submit
    } else if (el.kind === "header") {
      headerNodes.push(<GroupHeader text={el.text} scale={1.1} />);
    } else if (el.kind === "divider") {
      headerNodes.push(<Sep />);
    } else if (el.kind === "label" || el.kind === "body") {
      headerNodes.push(<Text>{`§7${el.text}`}</Text>);
    }
  }

  const onCancel = props.onFieldCancel;
  const showBack = props.onBack !== undefined;
  const onSubmit = props.onFieldSubmit;

  /*
   * ⚠️ Un arbre modal (`<Form>`) refuse les `Button` classiques : la flèche
   * retour y est donc rendue par un `Form.Button type="exit"` placé dans le
   * flux du formulaire, et le bandeau n'en reçoit AUCUNE (sinon le build jette
   * « a modal tree may contain only Form.* controls »). Le modal gère lui-même
   * son défilement : pas de `<Scroll>` ici.
   */
  return (
    <Panel width={"100%"} height={"100%"} flexDirection={"column"} padding={4} gap={3}>
      <Background texture={spec.bg} />
      <Banner design={props.design} title={props.title} />
      <Form
        onSubmit={(values): void => {
          onSubmit(values as Record<string, unknown>);
          exit();
        }}
        onCancel={(): void => {
          onCancel();
          exit();
        }}
      >
        <Panel width={"100%"} flexDirection={"column"} gap={4} padding={6} background={PANE_TEXTURE}>
          <Panel width={"100%"} flexDirection={"column"} gap={3}>
            {headerNodes}
          </Panel>
          <Panel width={"100%"} flexDirection={"column"} gap={3}>
            {fieldNodes}
          </Panel>
          {showBack ? <Form.Button type={"exit"} label={"← Retour"} /> : null}
          <Form.Button type={"submit"} label={submitLabel} />
        </Panel>
      </Form>
    </Panel>
  );
}

/* --- Lignes de champ (label + contrôle natif) ------------------------------ */

function FieldLabel({ label }: { label: string }): JSX.Element {
  return <Text>{`§7${label}`}</Text>;
}

function FormToggleRow({
  name,
  label,
  initial,
}: {
  name: string;
  label: string;
  initial: boolean;
}): JSX.Element {
  return (
    <Panel width={"100%"} flexDirection={"column"} gap={2} marginBottom={2}>
      <FieldLabel label={label} />
      <Form.Toggle name={name} defaultValue={initial} />
    </Panel>
  );
}

function FormSliderRow({
  name,
  label,
  min,
  max,
  step,
  initial,
}: {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  initial: number;
}): JSX.Element {
  return (
    <Panel width={"100%"} flexDirection={"column"} gap={2} marginBottom={2}>
      <FieldLabel label={label} />
      <Form.Slider name={name} min={min} max={max} step={step} defaultValue={initial} />
    </Panel>
  );
}

function FormInputRow({
  name,
  label,
  placeholder,
  initial,
}: {
  name: string;
  label: string;
  placeholder: string;
  initial: string;
}): JSX.Element {
  return (
    <Panel width={"100%"} flexDirection={"column"} gap={2} marginBottom={2}>
      <FieldLabel label={label} />
      <Form.Input name={name} placeholder={placeholder} defaultValue={initial} />
    </Panel>
  );
}

function FormDropdownRow({
  name,
  label,
  options,
  initial,
}: {
  name: string;
  label: string;
  options: string[];
  initial: number;
}): JSX.Element {
  return (
    <Panel width={"100%"} flexDirection={"column"} gap={2} marginBottom={2}>
      <FieldLabel label={label} />
      <Form.Dropdown name={name} defaultValue={options[initial] ?? ""}>
        {options.map((text: string, index: number) => (
          <Form.Option value={`${index}`} label={text} />
        ))}
      </Form.Dropdown>
    </Panel>
  );
}

/* ---------------------------------------------------------------------------
 * OMForm — API conservée, rendu JSX.
 * ------------------------------------------------------------------------- */

export class OMForm {
  private readonly player: Player;
  private readonly titleText: string;
  private readonly design: ScreenDesign;
  private backAction: (() => void) | undefined;
  private readonly elements: FormElement[] = [];
  private mode: "actions" | "fields" = "actions";
  private resolveShow: ((reason: DataDrivenScreenClosedReason) => void) | undefined;

  constructor(player: Player, title: string, _hero?: HeroKind, design?: ScreenDesign) {
    this.player = player;
    this.titleText = title.replace(/§./g, "").trim();
    this.design = design ?? designForTitle(this.titleText);
  }

  /** Bannière de héros — désactivée (no-op conservé pour les appelants). */
  hero(_kind: HeroKind): OMForm {
    return this;
  }

  /** En-tête de section (or, gras). */
  header(text: string): OMForm {
    this.elements.push({ kind: "header", text: plain(text) });
    return this;
  }

  /** Paragraphe de texte. */
  body(text: string): OMForm {
    this.elements.push({ kind: "body", text: plain(text) });
    return this;
  }

  /** Ligne de texte discrète. */
  label(text: string): OMForm {
    this.elements.push({ kind: "label", text: plain(text) });
    return this;
  }

  /**
   * Entrée cliquable. Le libellé est aplati en UNE ligne (les labels
   * multi-lignes restent fragiles en JSON UI).
   */
  button(label: string, onClick: () => void, _options?: ButtonOptions, _icon?: UIIcon): OMForm {
    const flat = plain(label).replace(/\s*\n\s*/g, "  ·  ").trim();
    const wrapped = (): void => {
      try {
        onClick();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logMod.warn(`Action du menu « ${this.titleText} » échouée : ${message}`);
        this.player.sendMessage(
          `§c[NaLandia] L'action du menu « ${this.titleText} » a échoué : §f${message}`,
        );
      }
    };
    this.elements.push({ kind: "button", text: flat, onClick: wrapped });
    return this;
  }

  divider(): OMForm {
    this.elements.push({ kind: "divider", text: "" });
    return this;
  }

  spacer(): OMForm {
    return this;
  }

  /**
   * Bouton RETOUR : une pastille-flèche blanche vers la gauche, en HAUT À
   * GAUCHE du bandeau de titre — ce n'est PAS une entrée de la liste.
   */
  back(onBack: () => void): OMForm {
    this.backAction = onBack;
    return this;
  }

  /** Ajoute un champ : bascule l'écran en mode `ModalFormData`. */
  private addField(
    renderField: (name: string) => JSX.Element,
    read: (value: unknown) => void,
  ): void {
    const name = `f${this.elements.filter((el) => el.kind === "field").length}`;
    this.mode = "fields";
    this.elements.push({ kind: "field", name, render: () => renderField(name), read });
  }

  toggle(label: string, initial: boolean): OMForm {
    this.addField((name) => <FormToggleRow name={name} label={label} initial={initial} />, () => {});
    return this;
  }

  toggleOb(label: string, observable: ObservableBoolean): OMForm {
    this.addField(
      (name) => <FormToggleRow name={name} label={label} initial={observable.getData()} />,
      (value) => {
        if (typeof value === "boolean") observable.setData(value);
      },
    );
    return this;
  }

  slider(
    label: string,
    observable: ObservableNumber,
    min: number,
    max: number,
    options?: SliderOptions,
  ): OMForm {
    const current = Math.min(Math.max(observable.getData(), min), max);
    const step = options?.step ?? 1;
    this.addField(
      (name) => (
        <FormSliderRow name={name} label={label} min={min} max={max} step={step} initial={current} />
      ),
      (value) => {
        if (typeof value === "number") observable.setData(value);
      },
    );
    return this;
  }

  dropdown(label: string, observable: ObservableNumber, items: (DropdownItemData | string)[]): OMForm {
    const labels = items.map((item, index) =>
      typeof item === "string" ? item : item.label || `Option ${index + 1}`,
    );
    const initial = Math.min(Math.max(observable.getData(), 0), Math.max(labels.length - 1, 0));
    this.addField(
      (name) => <FormDropdownRow name={name} label={label} options={labels} initial={initial} />,
      (value) => {
        if (typeof value === "number") observable.setData(value);
      },
    );
    return this;
  }

  textField(label: string, observable: ObservableString, options?: TextFieldOptions): OMForm {
    const placeholder = options?.placeholder ?? "…";
    this.addField(
      (name) => (
        <FormInputRow
          name={name}
          label={label}
          placeholder={placeholder}
          initial={observable.getData()}
        />
      ),
      (value) => {
        if (typeof value === "string") observable.setData(value);
      },
    );
    return this;
  }

  /** Compat : les formulaires JSX ont leur propre contrôle de fermeture. */
  closeButton(): OMForm {
    return this;
  }

  isShowing(): boolean {
    return false;
  }

  closeIfShowing(): void {
    /* le runtime gère lui-même le remplacement d'écran */
  }

  /**
   * Affiche le menu. Différé de 2 ticks : un `render()` dans le même tick qu'une
   * fermeture est perdu en silence.
   */
  show(): Promise<DataDrivenScreenClosedReason> {
    return new Promise<DataDrivenScreenClosedReason>((resolve) => {
      this.resolveShow = resolve;
      system.runTimeout(() => {
        try {
          this.present();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          logMod.warn(`Menu « ${this.titleText} » : ${message}`);
          this.player.sendMessage(
            `§c[NaLandia] Le menu « ${this.titleText} » n'a pas pu s'afficher : §f${message}`,
          );
          this.close("ServerClosed");
        }
      }, 2);
    });
  }

  private close(reason: DataDrivenScreenClosedReason): void {
    const resolve = this.resolveShow;
    this.resolveShow = undefined;
    resolve?.(reason);
  }

  private present(): void {
    const props: RootProps = {
      design: this.design,
      title: this.titleText,
      onBack: this.backAction,
      elements: this.elements,
      onClose: (): void => this.close("UserClosed"),
      onAction: (onClick: () => void): void => {
        onClick();
        this.close("UserClosed");
      },
      onFieldSubmit: (values: Record<string, unknown>): void => this.applyFields(values),
      onFieldCancel: (): void => {
        const back = this.backAction;
        if (back) back();
        this.close("UserClosed");
      },
    };
    const Screen = this.mode === "fields" ? FieldsScreen : ActionsScreen;
    render(<Screen {...props} />, this.player);
  }

  /** Réinjecte les valeurs du `<Form>` dans les lecteurs de champs hérités. */
  private applyFields(values: Record<string, unknown>): void {
    const fields = this.elements.filter((el): el is FieldElement => el.kind === "field");
    for (const field of fields) {
      const raw = values[field.name];
      if (raw !== undefined && raw !== null) field.read(raw);
    }
    const submit = [...this.elements].reverse().find((el) => el.kind === "button");
    if (submit && submit.kind === "button") submit.onClick();
    this.close("UserClosed");
  }
}

/* ---------------------------------------------------------------------------
 * Ouvertures normalisées (mêmes signatures que l'ancien moteur)
 * ------------------------------------------------------------------------- */

/** Construit et affiche une fenêtre ; rapporte les erreurs EN JEU. */
function buildAndShow(
  player: Player,
  title: string,
  build: (form: OMForm) => void,
  design: ScreenDesign,
  hero?: HeroKind,
): Promise<DataDrivenScreenClosedReason> {
  const shortName = title.replace(/§./g, "").trim();
  return new Promise<DataDrivenScreenClosedReason>((resolve, reject) => {
    system.runTimeout(() => {
      let form: OMForm;
      try {
        form = new OMForm(player, title, hero, design);
        build(form);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logMod.warn(`Menu « ${shortName} » n'a pas pu se construire : ${message}`);
        player.sendMessage(
          `§c[NaLandia] Le menu « ${shortName} » n'a pas pu se construire : §f${message}`,
        );
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      form.show().then(resolve, (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logMod.warn(`Menu « ${shortName} » n'a pas pu s'afficher : ${message}`);
        player.sendMessage(
          `§c[NaLandia] Le menu « ${shortName} » n'a pas pu s'afficher : §f${message}`,
        );
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    }, 2);
  });
}

/** Ouvre une fenêtre NaLandia ; la famille visuelle vient de la section. */
export function openWindow(
  player: Player,
  section: string,
  build: (form: OMForm) => void,
  hero?: HeroKind,
): Promise<DataDrivenScreenClosedReason> {
  return buildAndShow(player, sheetTitleFor(section), build, designForSection(section), hero);
}

/** Fenêtre avec titre brut (famille déduite du titre). */
export function openWindowRaw(
  player: Player,
  title: string,
  build: (form: OMForm) => void,
): Promise<DataDrivenScreenClosedReason> {
  return buildAndShow(player, title, build, designForTitle(title.replace(/§./g, "").trim()));
}

/** Ferme l'écran ouvert pour ce joueur (compat). */
export function closeOpenForm(_player: Player): void {
  /* le runtime gère le remplacement d'écran */
}

/** Type de réponse MessageForm (compat imports). */
export type { MessageFormResponse };
