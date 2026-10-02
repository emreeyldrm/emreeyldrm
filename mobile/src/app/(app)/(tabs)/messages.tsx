import { View } from 'react-native';
import { Icon } from '../../../components/Icon';
import { LargeTitle, Screen, Txt } from '../../../components/ui';
import { C } from '../../../theme';

/** Placeholder: messaging (Chat.dc.html) is not part of this release. */
export default function Messages() {
  return (
    <Screen>
      <View style={{ padding: 20, paddingTop: 24, gap: 20 }} testID="messages-soon">
        <LargeTitle>Mesajlar</LargeTitle>
        <View style={{ backgroundColor: C.orangeTint, borderRadius: 20, padding: 20, gap: 10, alignItems: 'flex-start' }}>
          <Icon name="chat" size={32} color={C.orangeText} />
          <Txt weight="extrabold" size={18} color={C.orangeText}>Yakında</Txt>
          <Txt size={14} color={C.secondary}>Arkadaşlarınla liste ve yer paylaşabileceğin mesajlaşma yakında geliyor.</Txt>
        </View>
      </View>
    </Screen>
  );
}
