/**
 * Kit UI NaLandia — socle visuel commun au-dessus de @bedrock-core/ui.
 *
 * L'identité visuelle vient du DESIGN SYSTEM officiel du framework
 * (@bedrock-core/ore-styled : Header, MenuRow, Card, Divider + tokens) —
 * celui-là même que le framework utilise pour ses propres écrans (guides).
 * Ce kit ne pose AUCUNE texture maison : il COMPOSE les briques officielles
 * en layouts NaLandia (sidebar + contenu, fiche, sections).
 *
 * Pattern de structure (copié des écrans officiels du framework) :
 *   <Card padding={0}>            ← racine plein viewport
 *     <Header />                  ← barre : retour + titre + ×
 *     <Panel flexGrow>            ← zone de contenu
 *       <Scroll>…</Scroll>        ← régions défilantes (max 2 par écran !)
 *     </Panel>
 *   </Card>
 *
 * Règle d'or : tout ce qui est ici est réutilisable, tout ce qui est dans un
 * écran est spécifique. Une brique manquante se crée ICI, jamais dans l'écran.
 */
import { Card, Divider, Header, MenuRow, theme } from "@bedrock-core/ore-styled";
import { Panel, Scroll, Text, useExit } from "@bedrock-core/ui";
import type { JSX } from "@bedrock-core/ui";

const { spacing } = theme.tokens;

export { Card, Divider, Header, MenuRow, theme };

// ---------------------------------------------------------------------------
// Briques de base
// ---------------------------------------------------------------------------

/** Titre de section : police Ore UI (`minecraftTen`) + filet sombre. */
export function SectionTitle(props: { label: string; marginTop?: boolean }) {
  return (
    <>
      <Text
        font="minecraftTen"
        shadow={true}
        maxLines={1}
        overflow="ellipsis"
        marginTop={props.marginTop === true ? spacing.sm : undefined}
      >
        {props.label}
      </Text>
      <Divider variant="dark" />
    </>
  );
}

/** Bloc de texte multi-ligne : chaque \n devient une ligne (codes § supportés). */
export function BodyLines(props: { text: string }) {
  const lines = props.text.split("\n");
  return (
    <>
      {lines.map((line) => (
        <Text wordBreak="break-word">{line}</Text>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Compositions : écran, navigation, contenu
// ---------------------------------------------------------------------------

/**
 * Écran complet plein viewport, pattern officiel du framework : Card racine +
 * Header (retour optionnel + × qui ferme) + zone de contenu qui remplit.
 */
export function AppShell(props: {
  title: string;
  onBack?: () => void;
  children?: JSX.Node;
}) {
  const exit = useExit();
  return (
    <Card flexDirection="column" padding={0} gap={0}>
      <Header title={props.title} onBack={props.onBack} onClose={exit} />
      <Panel
        flexGrow={1}
        flexShrink={1}
        flexDirection="column"
        gap={spacing.sm}
        padding={spacing.sm}
      >
        {props.children}
      </Panel>
    </Card>
  );
}

/**
 * Colonne de navigation : MenuRows (titre + sous-titre + chevron, 3 états)
 * dans une région défilante. `width` en % du parent (défaut 35 %).
 */
export function NavColumn(props: {
  items: Array<{
    title: string;
    subtitle?: string;
    onPress: () => void;
    enabled?: boolean;
  }>;
  width?: number | `${number}%`;
}) {
  return (
    <Scroll width={props.width ?? "35%"}>
      <Panel flexDirection="column" gap={spacing.xs}>
        {props.items.map((item) => (
          <MenuRow
            title={item.title}
            subtitle={item.subtitle}
            onPress={item.onPress}
            enabled={item.enabled ?? true}
          />
        ))}
      </Panel>
    </Scroll>
  );
}

/** Carte de contenu (panneau droit d'un layout sidebar, ou corps de fiche). */
export function ContentCard(props: {
  children?: JSX.Node;
  flexGrow?: number;
  width?: number | `${number}%`;
}) {
  return (
    <Card
      variant="raised"
      flexDirection="column"
      gap={spacing.sm}
      padding={spacing.sm}
      flexGrow={props.flexGrow}
      width={props.width}
    >
      {props.children}
    </Card>
  );
}

/**
 * Layout « console » : navigation à gauche (scrollable), carte de contenu à
 * droite. Un seul <Scroll> → dans la limite des 2 régions par écran.
 */
export function SidebarLayout(props: {
  title: string;
  nav: Array<{ title: string; subtitle?: string; onPress: () => void; enabled?: boolean }>;
  content: JSX.Node;
  onBack?: () => void;
}) {
  return (
    <AppShell title={props.title} onBack={props.onBack}>
      <Panel flexDirection="row" gap={spacing.sm} flexGrow={1}>
        <NavColumn items={props.nav} />
        <ContentCard flexGrow={1}>{props.content}</ContentCard>
      </Panel>
    </AppShell>
  );
}

/**
 * Fiche de lecture : écran simple (header + contenu scrollable).
 * Utilisée par les écrans de détail (classe, quête, document DB…).
 */
export function Sheet(props: {
  title: string;
  onBack?: () => void;
  children?: JSX.Node;
}) {
  return (
    <AppShell title={props.title} onBack={props.onBack}>
      <Scroll>
        <Panel flexDirection="column" gap={spacing.xs}>
          {props.children}
        </Panel>
      </Scroll>
    </AppShell>
  );
}
