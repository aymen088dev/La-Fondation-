/**
 * Kit UI NaLandia — socle visuel commun au-dessus de @bedrock-core/ui.
 *
 * Le framework (JSX + flexbox + scroll natif) fournit la MÉCANIQUE ; ce kit
 * fournit l'IDENTITÉ : fenêtre cuir/or aux textures om_*, boutons à 3 états,
 * en-tête à bandeau, listes scrollables et fiches. Aucun écran ne pose de
 * texture à la main : il assemble ces briques.
 *
 * Règle d'or : tout ce qui est ici est réutilisable, tout ce qui est dans un
 * écran est spécifique. Une brique manquante se crée ICI, jamais dans l'écran.
 */
import { Panel, Text, Button, Image, Scroll } from "@bedrock-core/ui";
import type { ControlProps } from "@bedrock-core/ui";
import type { JSX } from "@bedrock-core/ui";
import type { FlexSize } from "@bedrock-core/ui/flexbox";

// ---------------------------------------------------------------------------
// Textures du thème (générées par scripts/make_ui_textures.py)
// ---------------------------------------------------------------------------

const TEX = {
  window: "textures/ui/om_window",
  band: "textures/ui/om_header_band",
  card: "textures/ui/om_card",
  cardHover: "textures/ui/om_card_hover",
  cardPress: "textures/ui/om_card_press",
  btn: "textures/ui/om_btn",
  btnHover: "textures/ui/om_btn_hover",
  btnPress: "textures/ui/om_btn_press",
  plate: "textures/ui/om_plate",
} as const;

// Palette de couleurs (code de mise en forme Minecraft + RGB pour les fonds).
export const COLORS = {
  gold: "§6",
  cream: "§f",
  muted: "§7",
  dark: "§8",
  green: "§a",
  red: "§c",
  aqua: "§b",
  purple: "§d",
  yellow: "§e",
} as const;

// ---------------------------------------------------------------------------
// Briques de base
// ---------------------------------------------------------------------------

/** Fenêtre ornée : fond cuir/or, taille fixe, contenu centré. */
export function Window(props: { width: number; height: number; children?: JSX.Node }) {
  return (
    <Panel
      width={props.width}
      height={props.height}
      background={TEX.window}
      padding={6}
      flexDirection="column"
    >
      {props.children}
    </Panel>
  );
}

/** Bandeau de titre : bande dorée + texte centré (l'identité NaLandia). */
export function TitleBar(props: { title: string; subtitle?: string }) {
  return (
    <Panel height={20} flexDirection="column" gap={0}>
      <Panel height={18} background={TEX.band}>
        <Panel flexDirection="row" justifyContent="center" alignItems="center" width="100%" height="100%">
          <Text>{`§6§l${props.title}§r`}</Text>
        </Panel>
      </Panel>
      {props.subtitle !== undefined ? <Text>{`§8${props.subtitle}`}</Text> : null}
    </Panel>
  );
}

/** Bouton thémé NaLandia (3 états, textures om_card). */
export function TileButton(props: {
  label: string;
  onPress: () => void;
  width?: FlexSize;
  height?: number;
  enabled?: boolean;
}) {
  return (
    <Button
      width={props.width ?? 180}
      height={props.height ?? 24}
      background={TEX.card}
      backgroundHover={TEX.cardHover}
      backgroundPressed={TEX.cardPress}
      onPress={props.onPress}
      enabled={props.enabled ?? true}
    >
      <Text>{props.label}</Text>
    </Button>
  );
}

/** Petit bouton d'action (barre du bas, retours). */
export function SmallButton(props: {
  label: string;
  onPress: () => void;
  flex?: number;
  width?: number;
  enabled?: boolean;
}) {
  return (
    <Button
      flex={props.flex}
      width={props.width}
      height={22}
      background={TEX.btn}
      backgroundHover={TEX.btnHover}
      backgroundPressed={TEX.btnPress}
      onPress={props.onPress}
      enabled={props.enabled ?? true}
    >
      <Text>{props.label}</Text>
    </Button>
  );
}

/** Plaque de texte (le panneau de droite des menus sidebar). */
export function Plate(props: { children?: JSX.Node; flex?: number } & ControlProps) {
  return (
    <Panel background={TEX.plate} padding={8} flexDirection="column" gap={4} flex={props.flex} {...props}>
      {props.children}
    </Panel>
  );
}

/** Ligne de fiche : libellé doré à gauche, valeur crème à droite. */
export function InfoRow(props: { label: string; value: string }) {
  return (
    <Panel flexDirection="row" gap={6} height={14}>
      <Text>{`§e${props.label} §7:`}</Text>
      <Text>{`§f${props.value}`}</Text>
    </Panel>
  );
}

/** Séparateur discret. */
export function Divider() {
  return <Panel height={2}>{null}</Panel>;
}

// ---------------------------------------------------------------------------
// Compositions : sidebar + contenu, liste scrollable, fiche
// ---------------------------------------------------------------------------

/**
 * Layout « console » : colonne de navigation à gauche (scrollable), panneau
 * de contenu à droite. C'est la structure du hub, de l'admin et des menus à
 * liste. `nav` = boutons de gauche, `content` = panneau de droite.
 */
export function SidebarLayout(props: {
  title: string;
  nav: JSX.Node;
  content: JSX.Node;
  width?: number;
  height?: number;
}) {
  return (
    <Window width={props.width ?? 330} height={props.height ?? 236}>
      <TitleBar title={props.title} />
      <Panel flexDirection="row" gap={6} height="100%" paddingTop={4}>
        <Scroll width={150}>
          <Panel flexDirection="column" gap={4}>
            {props.nav}
          </Panel>
        </Scroll>
        <Plate flex={1}>{props.content}</Plate>
      </Panel>
    </Window>
  );
}

/** Barre d'actions du bas (retour / fermer). */
export function FooterBar(props: { onBack?: () => void; backLabel?: string; onClose?: () => void }) {
  return (
    <Panel flexDirection="row" gap={6} height={24} paddingTop={4}>
      {props.onBack !== undefined ? (
        <SmallButton flex={1} label={`§7${props.backLabel ?? "Retour"}`} onPress={props.onBack} />
      ) : null}
      {props.onClose !== undefined ? <SmallButton flex={1} label="§7Fermer" onPress={props.onClose} /> : null}
    </Panel>
  );
}

/** Liste scrollable de boutons (menus génériques : joueurs, sanctions…). */
export function ScrollList(props: {
  items: Array<{ label: string; onPress: () => void; enabled?: boolean }>;
  width?: FlexSize;
  height?: FlexSize;
}) {
  return (
    <Scroll width={props.width ?? "100%"} height={props.height}>
      <Panel flexDirection="column" gap={3}>
        {props.items.map((item) => (
          <TileButton
            label={item.label}
            onPress={item.onPress}
            enabled={item.enabled ?? true}
            width="100%"
          />
        ))}
      </Panel>
    </Scroll>
  );
}

/**
 * Fiche de lecture : fenêtre simple (titre + contenu scrollable + pied).
 * Utilisée par les écrans de détail (classe, quête, document DB…).
 */
export function Sheet(props: {
  title: string;
  children?: JSX.Element;
  footer?: JSX.Element;
  width?: number;
  height?: number;
}) {
  return (
    <Window width={props.width ?? 300} height={props.height ?? 220}>
      <TitleBar title={props.title} />
      <Scroll height="100%" paddingTop={4}>
        <Panel flexDirection="column" gap={4}>
          {props.children}
        </Panel>
      </Scroll>
      <Panel height={24}>{props.footer}</Panel>
    </Window>
  );
}

/** Image thémée (drapeaux, mondes…) avec taille fixe. */
export function ThemedImage(props: { texture: string; width: number; height: number }) {
  return <Image texture={props.texture} width={props.width} height={props.height} />;
}
