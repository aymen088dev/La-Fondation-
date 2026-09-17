/**
 * Thème graphique commun à toutes les GUI OpenMontage.
 *
 * ⚠️ Tous les chemins d'icônes sont VÉRIFIÉS contre Mojang/bedrock-samples
 * (fichier .png existant dans resource_pack/textures/). Un chemin invalide
 * = bouton silencieusement sans icône — c'était la cause des icônes manquantes.
 */

import { logMod } from "../lib/log";
import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import {
  CustomForm,
  ObservableString,
  ObservableNumber,
  ObservableBoolean,
  type UIRawMessage,
} from "@minecraft/server-ui";
import type {
  ButtonOptions,
  DataDrivenScreenClosedReason,
  DividerOptions,
  DropdownItemData,
  DropdownOptions,
  ImageOptions,
  SliderOptions,
  SpacingOptions,
  TextFieldOptions,
  TextOptions,
  ToggleOptions,
} from "@minecraft/server-ui";

/**
 * Identifiant du Resource Pack OpenMontage pour l'API DDUI (bêta).
 *
 * ⚠️ `imagePackId` attend l'IDENTIFIANT du pack = son UUID (le même `pack_id`
 * que dans world_resource_packs.json), PAS son nom d'affichage. Passer le
 * nom ne matche aucun pack : les images sont silencieusement ignorées et
 * les menus s'affichent sans aucune texture (cause du bug "menus non
 * custom alors que le RP est chargé").
 */
export const RP_PACK_ID = "33ca6e1c-4f30-46ae-8b56-1510382e3f61";

/** Palette du thème. */
export const THEME = {
  /** Couleur principale (vert menthe). */
  primary: "§a",
  /** Couleur secondaire (or). */
  accent: "§6",
  /** Danger. */
  danger: "§c",
  /** Texte discret. */
  muted: "§7",
} as const;

/**
 * Icônes OM (RP OpenMontage, tuiles 32x32 pixel-art générées par
 * scripts/make_ui_textures.py). Utilisées comme imageDetails des boutons
 * DDUI — dans NOTRE pack donc toujours chargées (plus de chemins vanilla
 * dont l'existence dépendait du client).
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

/** Chemin RP d'une icône OM (tuile 32x32, extension requise par le DDUI). */
export function OM_ICON(icon: UIIcon): string {
  return `textures/ui/om_ic_${OM_ICONS[icon]}.png`;
}

/** Alias de compat : les menus historiques importent ICONS. */
export const ICONS = OM_ICONS;

/**
 * Bannières de héros (RP OpenMontage, 256x48 — panneaux slate à ruban
 * accent et clef de voûte or, générées par make_ui_textures.py).
 * Affichées en tête des menus principaux via OMForm.hero().
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

/** Chemin RP d'une bannière de héros (extension requise par le DDUI). */
function heroPath(kind: HeroKind): string {
  return `textures/ui/${HEROES[kind]}.png`;
}

/**
 * Fond d'actionbar custom (RP OpenMontage, référencé par RP/ui/hud_screen.json).
 */
export const OM_PANEL_TEXTURE = "textures/ui/om_actionbar_bg";

/**
 * Interrupteur du design complet (héros + icônes). Si le client n'a pas le
 * bon RP (cache de pack), les images peuvent empêcher l'ouverture des
 * écrans : `/scriptevent sn:ui off` bascule un rendu SANS image, garanti
 * fonctionnel ; `sn:ui on` réactive.
 */
let uiDesignEnabled = true;

/**
 * Désactivation automatique du design image : si un écran échoue à
 * s'afficher alors qu'il contenait des images, on coupe héros + icônes pour
 * la suite — les prochains menus s'affichent donc TOUJOURS (dégradation
 * propre plutôt que des commandes qui « n'ouvrent rien »).
 */
function disableUiDesign(reason: string): void {
  if (!uiDesignEnabled) return;
  uiDesignEnabled = false;
  logMod.warn(`Images désactivées automatiquement (${reason}) — menus sans image pour rester fonctionnels. /scriptevent sn:ui on pour réactiver.`);
}

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

/** Ligne de séparation pour les body. */
export function divider(): string {
  return "§8─────────────────────";
}

// ---------------------------------------------------------------------------
// Moteur DDUI (CustomForm, bêta server-ui 2.3) — la vraie UI custom.
// Contrairement aux forms vanilla (ActionFormData...), les boutons ont des
// CALLBACKS DIRECTS (pas d'indexation fragile par position), et le layout
// est riche : headers, dividers, toggles, images du RP.
// ---------------------------------------------------------------------------

/** Texte lié ( champ éditable, label réactif). */
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

/**
 * Booléen lié avec callback au changement — pour les toggles DDUI dont
 * l'effet doit être immédiat (ex : activer/désactiver un module).
 */
export function obToggle(
  initial: boolean,
  onChange: (value: boolean) => void,
): ObservableBoolean {
  const observable = new ObservableBoolean(initial);
  observable.subscribe(onChange);
  return observable;
}

/** Message UI en rawtext : SEUL format où les codes § sont interprétés
 *  par le rendu DDUI (les strings brutes affichent les §l littéralement). */
function uiText(text: string): UIRawMessage {
  return { rawtext: [{ text }] };
}

/**
 * Enveloppe CustomForm du thème. Apports :
 * 1. tout texte passé en string est converti en UIRawMessage (codes § rendus) ;
 * 2. le formulaire ouvert est suivi par joueur : la fermeture centralisée
 *    (`closeOpenForm`) permet aux menus de fermer l'écran courant avant
 *    d'ouvrir le suivant (sinon les écrans s'empilent).
 */
export class OMForm {
  readonly inner: CustomForm;
  private readonly player: Player;
  private readonly titleText: string;

  constructor(player: Player, title: string) {
    this.player = player;
    this.titleText = title.replace(/§./g, "").trim();
    this.inner = new CustomForm(player, uiText(title));
  }

  /** Ferme ce formulaire si l'écran s'affiche encore (sinon no-op). */
  closeIfShowing(): void {
    try {
      if (this.inner.isShowing()) this.inner.close();
    } catch {
      // L'écran a déjà été fermé (client ou autre écran) — rien à faire.
    }
  }

  /**
   * Bannière de héros en tête de menu (image pleine largeur du RP OM).
   * À appeler EN PREMIER : c'est l'identité graphique du menu.
   * Fail-safe : si l'API/le pack refuse l'image, le menu s'ouvre quand même.
   */
  hero(kind: HeroKind): OMForm {
    if (!uiDesignEnabled) return this;
    try {
      this.inner.image(heroPath(kind), RP_PACK_ID, { width: 1 });
    } catch {
      // Image impossible (RP absent du client…) : on dégrade sans planter.
    }
    return this;
  }

  header(text: string, options?: Omit<TextOptions, "tooltip">): OMForm {
    this.inner.header(uiText(text), options);
    return this;
  }

  label(text: string, options?: Omit<TextOptions, "tooltip">): OMForm {
    this.inner.label(uiText(text), options);
    return this;
  }

  button(
    label: string,
    onClick: () => void,
    options?: ButtonOptions,
    /** Icône OM affichée à côté du label (imageDetails du RP OpenMontage). */
    icon?: UIIcon,
  ): OMForm {
    const imageDetails =
      icon === undefined || !uiDesignEnabled
        ? undefined
        : { imagePackId: RP_PACK_ID, imageSrc: OM_ICON(icon) };
    const handler = () => {
      // Un clic quitte TOUJOURS l'écran courant :
      // - navigation : le menu ouvert par onClick remplace celui-ci ;
      // - action terminale (création, sanctions…) : l'écran se referme.
      closeOpenForm(this.player);
      // ⚠️ Une exception dans l'action (manager.create, sanctions…) sortirait
      // du callback de l'API et mourrait en silence : on la rapporte EN JEU.
      try {
        onClick();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logMod.warn(`Action du menu « ${this.titleText} » échouée : ${message}`);
        this.player.sendMessage(`§c[OM] L'action du menu « ${this.titleText} » a échoué : §f${message}`);
      }
    };
    try {
      this.inner.button(
        uiText(label),
        handler,
        imageDetails === undefined ? options : { ...options, imageDetails },
      );
    } catch {
      // imageDetails refusé (pack absent…) : réessai SANS image pour que
      // le bouton (et donc le menu) reste fonctionnel.
      if (imageDetails === undefined) throw new Error("OMForm.button a échoué sans image");
      this.inner.button(uiText(label), handler, options);
    }
    return this;
  }

  divider(options?: DividerOptions): OMForm {
    this.inner.divider(options);
    return this;
  }

  spacer(options?: SpacingOptions): OMForm {
    this.inner.spacer(options);
    return this;
  }

  toggle(
    label: string,
    toggled: ObservableBoolean,
    options?: ToggleOptions,
  ): OMForm {
    this.inner.toggle(uiText(label), toggled, options);
    return this;
  }

  slider(
    label: string,
    value: ObservableNumber,
    min: number | ObservableNumber,
    max: number | ObservableNumber,
    options?: SliderOptions,
  ): OMForm {
    this.inner.slider(uiText(label), value, min, max, options);
    return this;
  }

  dropdown(
    label: string,
    value: ObservableNumber,
    items: (DropdownItemData | string)[],
    options?: DropdownOptions,
  ): OMForm {
    // Tous les labels d'items passent en rawtext (codes § rendus) ; un item
    // string prend la valeur de son index. Les objets fournis par l'appelant
    // sont reconstruits (JAMAIS mutés) avec leur valeur explicite conservée.
    const data: DropdownItemData[] = items.map((item, index) => {
      if (typeof item === "string") return { label: uiText(item), value: index };
      return {
        ...item,
        label: typeof item.label === "string" ? uiText(item.label) : item.label,
      } as DropdownItemData;
    });
    this.inner.dropdown(uiText(label), value, data, options);
    return this;
  }

  textField(
    label: string,
    text: ObservableString,
    options?: TextFieldOptions,
  ): OMForm {
    this.inner.textField(uiText(label), text, options);
    return this;
  }

  image(src: string, pack: string, options?: ImageOptions): OMForm {
    this.inner.image(src, pack, options);
    return this;
  }

  closeButton(): OMForm {
    this.inner.closeButton();
    return this;
  }

  show(): Promise<DataDrivenScreenClosedReason> {
    // Robustesse : si un écran précédent est encore affiché (flux qui ne
    // passe pas par un bouton OMForm), on le ferme avant d'afficher celui-ci.
    const previous = openForms.get(this.player.id);
    if (previous !== undefined && previous !== this) previous.closeIfShowing();
    openForms.set(this.player.id, this);
    return this.inner.show().finally(() => {
      // Écran fermé (client ou serveur) : on retire le suivi, sauf si un
      // autre formulaire a déjà pris la place (navigation en cours).
      if (openForms.get(this.player.id) === this) {
        openForms.delete(this.player.id);
      }
    });
  }

  isShowing(): boolean {
    return this.inner.isShowing();
  }
}

/** Formulaire actuellement affiché, par joueur. */
const openForms = new Map<string, OMForm>();

/**
 * Ferme l'écran DDUI ouvert pour ce joueur, s'il y en a un.
 * À appeler AVANT d'ouvrir un autre menu (sinon les écrans s'empilent
 * et le clic d'un bouton laisse l'ancien menu à l'écran).
 */
export function closeOpenForm(player: Player): void {
  const current = openForms.get(player.id);
  if (current === undefined) return;
  openForms.delete(player.id);
  current.closeIfShowing();
}

/**
 * Construit et affiche une fenêtre DDUI.
 *
 * ⚠️ Deux pièges Bedrock gérés ici :
 * 1. Après `close()` d'un écran, re-montrer un autre DANS LE MÊME TICK le
 *    fait perdre en silence (l'ancien écran se referme sous le nouveau) :
 *    le show() est donc différé de 2 ticks.
 * 2. Si l'écran contient des images que le client ne peut pas rendre, la
 *    promesse `show()` peut échouer : on reconstruit alors TOUT le menu
 *    sans images pour qu'il s'affiche quand même.
 */
function buildAndShow(
  player: Player,
  title: string,
  build: (form: OMForm) => void,
  withCloseButton: boolean,
): Promise<DataDrivenScreenClosedReason> {
  /** Nom court du menu pour les messages en jeu (sans les codes §). */
  const shortName = title.replace(/§./g, "").trim();

  const buildForm = (): OMForm => {
    const form = new OMForm(player, title);
    build(form);
    if (withCloseButton) form.closeButton();
    return form;
  };

  /** Rend l'erreur VISIBLE en jeu (un console.warn seul = personne ne le lit). */
  const report = (what: string, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    logMod.warn(`Menu « ${shortName} » ${what} : ${message}`);
    player.sendMessage(`§c[OM] Le menu « ${shortName} » ${what} : §f${message}`);
  };

  // Différé de 2 ticks : un show() dans le même tick qu'un close() est perdu.
  return new Promise<DataDrivenScreenClosedReason>((resolve, reject) => {
    system.runTimeout(() => {
      // ⚠️ try/catch AUTOUR de la construction : si build(form) lève (élément
      // refusé par l'API DDUI bêta), l'exception sortirait du runTimeout SANS
      // rejeter la promesse → menu mort en silence. On journalise ET on
      // affiche l'erreur EN JEU pour qu'elle soit diagnostiquable.
      let form: OMForm;
      try {
        form = buildForm();
      } catch (error: unknown) {
        report("n'a pas pu se construire", error);
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      form
        .show()
        .catch((error: unknown) => {
          // Échec d'affichage : si le design image était actif, on le coupe
          // et on retente UNE fois sans aucune image (le suivi du formulaire
          // ouvert est déjà géré par OMForm.show()).
          if (uiDesignEnabled) {
            disableUiDesign(error instanceof Error ? error.message : "écran refusé");
            return buildForm().show();
          }
          throw error;
        })
        .then(resolve, (error: unknown) => {
          report("n'a pas pu s'afficher", error);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    }, 2);
  });
}

/**
 * Ouvre une fenêtre DDUI (OMForm) avec le titre OpenMontage et un bouton
 * de fermeture.
 */
export function openWindow(
  player: Player,
  section: string,
  build: (form: OMForm) => void,
  /** Bannière de héros affichée en tête (identité graphique). */
  hero?: HeroKind,
): Promise<DataDrivenScreenClosedReason> {
  closeOpenForm(player);
  return buildAndShow(player, windowTitle(section), (form) => {
    if (hero !== undefined) form.hero(hero);
    build(form);
  }, true);
}

/** Fenêtre DDUI sans bouton fermer intégré (le menu gère ses retours). */
export function openWindowRaw(
  player: Player,
  title: string,
  build: (form: OMForm) => void,
): Promise<DataDrivenScreenClosedReason> {
  closeOpenForm(player);
  return buildAndShow(player, title, build, false);
}
