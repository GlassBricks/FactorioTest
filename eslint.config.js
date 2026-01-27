import eslint from "@eslint/js"
import tseslint from "typescript-eslint"
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments/configs"
import eslintPluginPrettier from "eslint-plugin-prettier/recommended"

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/",
      "**/*.d.ts",
      "**/*.js",
      "factorio-test-data/",
      "integration-tests/fixtures/",
      "cli/factorio-test-data-dir/",
    ],
  },

  eslint.configs.recommended,
  tseslint.configs.recommended,
  eslintComments.recommended,

  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-inferrable-types": [
        "warn",
        { ignoreProperties: true, ignoreParameters: true },
      ],
      "no-inner-declarations": "off",
      "no-constant-condition": "off",
      "no-template-curly-in-string": "error",
      "@eslint-community/eslint-comments/no-unused-disable": "error",
      "@eslint-community/eslint-comments/disable-enable-pair": [
        "error",
        { allowWholeFile: true },
      ],
    },
  },

  eslintPluginPrettier,
)
