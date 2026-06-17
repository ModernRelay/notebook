import React from "react";
import { Box, Text, useFocus, useInput } from "ink";
import type { ButtonRuntimeProps } from "@modernrelay/notebook-catalog";

interface ComponentCtx<P> {
  props: P;
  emit: (event: string) => void;
}

export function Button({
  props: p,
  emit,
}: ComponentCtx<ButtonRuntimeProps>): React.ReactElement {
  const { label, variant = "default" } = p;
  const { isFocused } = useFocus();

  useInput(
    (input, key) => {
      if (!isFocused) return;
      if (input === " " || key.return) {
        emit("press");
      }
    },
    { isActive: isFocused },
  );

  const color =
    variant === "primary"
      ? "green"
      : variant === "danger"
        ? "red"
        : undefined;

  return (
    <Box>
      <Text color={color} bold={isFocused}>
        {isFocused ? "▶ " : "  "}[ {label} ]
      </Text>
    </Box>
  );
}
