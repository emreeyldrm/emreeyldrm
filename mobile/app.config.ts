import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Expo app config (replaces app.json so Google Maps keys can come from the environment).
 *
 * Env contract (read at build/prebuild time; never commit real keys):
 *   GOOGLE_MAPS_IOS_API_KEY      Maps SDK for iOS key. When set, the iOS build links Google Maps
 *                                (react-native-maps/Google pod + GMSApiKey). Unset: Apple Maps only.
 *   GOOGLE_MAPS_ANDROID_API_KEY  Maps SDK for Android key (Android always renders Google Maps; required
 *                                for maps to show in release/dev builds).
 *   EXPO_PUBLIC_MAPS_PROVIDER    `google` | `apple` (default). Inlined into the JS bundle; the app passes
 *                                PROVIDER_GOOGLE to <MapView> on iOS only when this is `google` AND the
 *                                binary was built with GOOGLE_MAPS_IOS_API_KEY. Expo Go always uses Apple Maps.
 * In EAS builds set these as EAS environment variables / secrets (see mobile/README.md → TestFlight).
 */
const GREEN = '#2E7D5B';
const EAS_PROJECT_ID: string | undefined = process.env.EAS_PROJECT_ID || undefined;
const iosMapsKey = process.env.GOOGLE_MAPS_IOS_API_KEY || undefined;
const androidMapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY || undefined;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Voyage',
  slug: 'voyage',
  scheme: 'voyage',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'com.emreeyldrm.voyage',
    // Local/manual builds; EAS production builds bump it remotely (eas.json: appVersionSource remote + autoIncrement).
    buildNumber: '1',
    supportsTablet: false,
    config: {
      usesNonExemptEncryption: false,
      ...(iosMapsKey ? { googleMapsApiKey: iosMapsKey } : {}),
    },
    infoPlist: {
      // Turkish is the app's language; system dialogs follow it.
      CFBundleDevelopmentRegion: 'tr',
    },
  },
  android: {
    package: 'com.emreeyldrm.voyage',
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: GREEN,
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    ...(androidMapsKey ? { config: { googleMaps: { apiKey: androidMapsKey } } } : {}),
  },
  web: {
    favicon: './assets/favicon.png',
    output: 'single',
    bundler: 'metro',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        backgroundColor: GREEN,
        imageWidth: 200,
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission: 'Voyage, yer eklerken konumunu kullanmak için izin ister.',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Voyage, yerlere ve yorumlara fotoğraf eklemen için fotoğraflarına erişmek ister.',
        cameraPermission: 'Voyage, yerlere ve yorumlara fotoğraf çekip eklemen için kamerana erişmek ister.',
        microphonePermission: false,
      },
    ],
    [
      'react-native-maps',
      {
        iosGoogleMapsApiKey: iosMapsKey,
        androidGoogleMapsApiKey: androidMapsKey,
      },
    ],
  ],
  experiments: {
    typedRoutes: false,
  },
  extra: {
    ...config.extra,
    // `eas init` cannot edit a dynamic config: paste the project id it prints into EAS_PROJECT_ID at the top
    // (or export EAS_PROJECT_ID). Until then EAS commands ask to create/link the project.
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
  },
});
