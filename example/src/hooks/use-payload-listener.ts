import { BasePeer, onTextReceived } from "expo-nearby-connections";
import { useEffect, useState } from "react";
import { GiftedChat, IMessage } from "react-native-gifted-chat";

export function usePayloadListener(connectedPeers: BasePeer[] = []) {
  const [data, setData] = useState<IMessage[]>([]);

  useEffect(() => {
    const unsubscribe = onTextReceived((data) => {
      const peerName =
        connectedPeers.find((peer) => peer.peerId === data.peerId)?.name ??
        data.peerId;

      const newMessage = {
        _id: Date.now(),
        createdAt: new Date(),
        text: data.text,
        user: {
          _id: data.peerId,
          name: peerName,
        },
        received: true,
      } as IMessage;

      setData((previousMessages) =>
        GiftedChat.append(previousMessages, [newMessage])
      );
    });

    return () => {
      unsubscribe();
    };
  }, [connectedPeers]);

  return { data, setData };
}
