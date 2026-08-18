import React, { forwardRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { colors } from "./ui";

export interface SignatureSvgHandle {
  toDataURL: (callback: (base64: string) => void) => void;
}

export const SignatureBox = forwardRef<SignatureSvgHandle, {
  panHandlers: object;
  paths: string[];
  isEmpty: boolean;
  onClear: () => void;
}>(function SignatureBox({ panHandlers, paths, isEmpty, onClear }, ref) {
  return (
    <View>
      <View style={styles.pad} {...panHandlers}>
        <Svg ref={ref as never} width="100%" height="100%" style={StyleSheet.absoluteFill}>
          {paths.map((d, i) => (
            <Path key={i} d={d} stroke={colors.text} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </Svg>
        {isEmpty ? <Text style={styles.hint}>Sign here</Text> : null}
      </View>
      <Text style={styles.clearLink} onPress={onClear}>
        Clear signature
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  pad: {
    height: 200,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  hint: { color: colors.textMuted, fontSize: 14 },
  clearLink: { color: colors.primary, fontWeight: "600", marginTop: 8, textAlign: "right" },
});
