import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

export function T3Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  const aspectRatio = 60 / 57;
  return (
    <Svg
      accessibilityLabel="Annex"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="0 0 60 57"
    >
      <ThemedPath
        d="M0 57L21 0H39L60 57H45.5L41.6 45H18.4L14.5 57H0ZM22.2 33.5H37.8L30 9.5L22.2 33.5Z"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
    </Svg>
  );
}
