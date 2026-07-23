const { withAppBuildGradle } = require('@expo/config-plugins');

const TASK_MARKER = '// NovaCast RN 0.86 TV feature flags';
const TASK_SNIPPET = `

${TASK_MARKER}
tasks.named("generateReactNativeEntryPoint").configure {
    doLast {
        def entryPoint = file("\$buildDir/generated/autolinking/src/main/java/com/facebook/react/ReactNativeApplicationEntryPoint.java")
        if (!entryPoint.exists()) {
            return
        }

        def contents = entryPoint.getText("UTF-8")
        if (!contents.contains("NovaCast TV feature flags")) {
            contents = contents.replace(
                "import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint;",
                "import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint;\\n" +
                    "import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsProvider;\\n" +
                    "import com.facebook.react.internal.featureflags.ReactNativeNewArchitectureFeatureFlagsDefaults;\\n" +
                    "import java.lang.reflect.Method;",
            )
            contents = contents.replace(
                "DefaultNewArchitectureEntryPoint.load();",
                "// NovaCast TV feature flags\\n" +
                    "      try {\\n" +
                    "        boolean loaded = false;\\n" +
                    "        String[] loaderNames = {\\n" +
                    "            \\\"loadWithFeatureFlags\\$ReactAndroid_debug\\\",\\n" +
                    "            \\\"loadWithFeatureFlags\\$ReactAndroid_release\\\"\\n" +
                    "        };\\n" +
                    "        for (String loaderName : loaderNames) {\\n" +
                    "          try {\\n" +
                    "            Method loader = DefaultNewArchitectureEntryPoint.class.getDeclaredMethod(\\n" +
                    "                loaderName, ReactNativeFeatureFlagsProvider.class);\\n" +
                    "            loader.invoke(null, new ReactNativeNewArchitectureFeatureFlagsDefaults() {\\n" +
                    "              @Override public boolean enableImperativeFocus() { return true; }\\n" +
                    "              @Override public boolean enableKeyEvents() { return true; }\\n" +
                    "            });\\n" +
                    "            loaded = true;\\n" +
                    "            break;\\n" +
                    "          } catch (NoSuchMethodException ignored) {\\n" +
                    "            // The method suffix differs between debug and release AARs.\\n" +
                    "          }\\n" +
                    "        }\\n" +
                    "        if (!loaded) {\\n" +
                    "          throw new IllegalStateException(\\\"React Native feature-flag loader not found\\\");\\n" +
                    "        }\\n" +
                    "      } catch (ReflectiveOperationException error) {\\n" +
                    "        throw new RuntimeException(error);\\n" +
                    "      }",
            )
            entryPoint.write(contents, "UTF-8")
        }
    }
}
`;

function withNovacastFeatureFlags(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      return config;
    }

    if (!config.modResults.contents.includes(TASK_MARKER)) {
      config.modResults.contents += TASK_SNIPPET;
    }

    return config;
  });
}

module.exports = withNovacastFeatureFlags;
