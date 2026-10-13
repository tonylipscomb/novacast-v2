// Minimal Node-only stand-ins for React Native primitives used while loading
// pure data/repository modules. These are test-runner infrastructure only; no
// application bundle imports this file.
export const Platform = { OS: 'android', select: (values) => values?.android ?? values?.default };
export const StyleSheet = { create: (styles) => styles, absoluteFill: {} };
export const View = 'View';
export const Text = 'Text';
export const Pressable = 'Pressable';
export const FlatList = 'FlatList';
export const ScrollView = 'ScrollView';
export const Modal = 'Modal';
export const Image = 'Image';
export const SafeAreaView = 'SafeAreaView';
export const ActivityIndicator = 'ActivityIndicator';
export const Dimensions = { get: () => ({ width: 1920, height: 1080 }) };
export const useWindowDimensions = () => ({ width: 1920, height: 1080, scale: 1, fontScale: 1 });
export const findNodeHandle = () => null;
export const BackHandler = { addEventListener: () => ({ remove() {} }) };
export const InteractionManager = { runAfterInteractions: (callback) => { callback?.(); return { cancel() {} }; } };
export const AccessibilityInfo = { isScreenReaderEnabled: async () => false };
export const Animated = { Value: class { setValue() {} }, timing: () => ({ start() {}, stop() {} }), View: 'Animated.View' };
export const Easing = { out: (value) => value, quad: (value) => value };
export const Alert = { alert() {} };
export const Keyboard = { dismiss() {} };
export const Linking = { openURL: async () => undefined };
export const useColorScheme = () => 'dark';
export const useTVEventHandler = () => undefined;
