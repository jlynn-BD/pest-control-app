import { Platform, Text, TextInput } from "react-native";
import { fonts } from "../components/ui";

// Blue Duck's typefaces everywhere. A piece of text that names its own font
// (Barlow headings, Krona One titles) keeps it; one that doesn't used to fall
// back to the phone's system font. This gives every Text and TextInput Red Hat
// Text as the starting font, so anything that forgets to set one is still on
// brand. The explicit style always comes last, so it wins.
//
// Web only: the native apps don't bundle the brand fonts, and the field app
// runs from the website (installed to the home screen).
type Renderable = { render?: (props: { style?: unknown }, ref: unknown) => unknown; __brandFont?: boolean };

function withDefaultFont(component: unknown) {
  const c = component as Renderable;
  const original = c.render;
  if (!original || c.__brandFont) return;
  c.__brandFont = true;
  c.render = (props, ref) => original({ ...props, style: [{ fontFamily: fonts.body }, props.style] }, ref);
}

if (Platform.OS === "web") {
  withDefaultFont(Text);
  withDefaultFont(TextInput);
}
