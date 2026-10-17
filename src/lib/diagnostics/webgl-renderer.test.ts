import { describe, expect, test } from "bun:test";
import { classifyRenderer } from "./webgl-renderer";

describe("classifyRenderer", () => {
  test("flags CPU fallbacks as software", () => {
    expect(classifyRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)")).toBe("software");
    expect(classifyRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe("software");
  });

  test("treats a named GPU as hardware", () => {
    expect(classifyRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("hardware");
  });
});
