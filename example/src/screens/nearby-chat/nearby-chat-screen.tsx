import {
  BasePeer,
  acceptConnection,
  disconnect,
  onConnected,
  onDisconnected,
  onInvitationReceived,
  onPeerFound,
  onPeerLost,
  requestConnection,
  sendText,
  startAdvertise,
  startDiscovery,
  stopAdvertise,
  stopDiscovery,
  Strategy,
} from "expo-nearby-connections";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { GiftedChat, IMessage } from "react-native-gifted-chat";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../../components/button";
import { Header } from "../../components/header";
import { colors } from "../../constants/color";
import { usePayloadListener } from "../../hooks/use-payload-listener";
import { useNearbyPermission } from "../../hooks/use-permission";

interface Props {}

function createDeviceName() {
  const label = Platform.OS === "ios" ? "iPhone" : "Android";
  const suffix = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0");

  return `${label} ${suffix}`;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Something went wrong while starting nearby connections.";
}

function shouldInitiateConnection(
  myDeviceName: string,
  targetDeviceName: string
) {
  return myDeviceName.localeCompare(targetDeviceName) < 0;
}

function getConnectionStatus(connectedPeers: BasePeer[]) {
  if (connectedPeers.length === 0) {
    return "Looking for nearby chats...";
  }

  if (connectedPeers.length === 1) {
    return `Connected with ${connectedPeers[0].name}`;
  }

  return `Connected with ${connectedPeers.length} peers`;
}

export const NearbyChatScreen: React.FC<Props> = () => {
  const [deviceName] = useState(createDeviceName);
  const [myPeerId, setMyPeerId] = useState("");
  const [connectedPeers, setConnectedPeers] = useState<BasePeer[]>([]);
  const [statusText, setStatusText] = useState(
    "Requesting nearby permissions..."
  );
  const [startupError, setStartupError] = useState<string>();
  const [restartToken, setRestartToken] = useState(0);
  const requestedPeerIds = useRef(new Set<string>());
  const acceptedPeerIds = useRef(new Set<string>());
  const insets = useSafeAreaInsets();
  const { isGranted, requestPermissionHandler } = useNearbyPermission();
  const { data, setData } = usePayloadListener(connectedPeers);
  const isConnected = connectedPeers.length > 0;

  useEffect(() => {
    if (!isGranted) {
      setStatusText("Waiting for nearby permissions...");
      return;
    }

    let isMounted = true;

    setStartupError(undefined);
    setStatusText("Starting advertise and discovery...");

    Promise.allSettled([
      startAdvertise(deviceName, Strategy.P2P_CLUSTER),
      startDiscovery(deviceName, Strategy.P2P_CLUSTER),
    ]).then((results) => {
      if (!isMounted) {
        return;
      }

      const peerIdResult = results.find(
        (result): result is PromiseFulfilledResult<string> =>
          result.status === "fulfilled"
      );

      if (peerIdResult) {
        setMyPeerId(peerIdResult.value);
        setStatusText("Looking for nearby chats...");
      }

      const rejectedResults = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );

      if (rejectedResults.length > 0) {
        setStartupError(getErrorMessage(rejectedResults[0].reason));
      }

      if (!peerIdResult) {
        setStatusText("Unable to start nearby connections.");
      }
    });

    return () => {
      isMounted = false;
      stopAdvertise().catch(() => {});
      stopDiscovery().catch(() => {});
    };
  }, [deviceName, isGranted, restartToken]);

  useEffect(() => {
    const unsubscribePeerFound = onPeerFound((peer) => {
      if (
        requestedPeerIds.current.has(peer.peerId) ||
        connectedPeers.some(
          (connectedPeer) => connectedPeer.peerId === peer.peerId
        ) ||
        !shouldInitiateConnection(deviceName, peer.name)
      ) {
        return;
      }

      requestedPeerIds.current.add(peer.peerId);
      setStatusText(`Connecting to ${peer.name}...`);

      requestConnection(peer.peerId).catch(() => {
        requestedPeerIds.current.delete(peer.peerId);
        setStatusText(getConnectionStatus(connectedPeers));
      });
    });

    const unsubscribeInvitationReceived = onInvitationReceived((peer) => {
      if (
        acceptedPeerIds.current.has(peer.peerId) ||
        connectedPeers.some(
          (connectedPeer) => connectedPeer.peerId === peer.peerId
        )
      ) {
        return;
      }

      acceptedPeerIds.current.add(peer.peerId);
      setStatusText(`Accepting ${peer.name}...`);

      acceptConnection(peer.peerId).catch(() => {
        acceptedPeerIds.current.delete(peer.peerId);
        setStatusText(getConnectionStatus(connectedPeers));
      });
    });

    const unsubscribePeerLost = onPeerLost((peer) => {
      requestedPeerIds.current.delete(peer.peerId);
      acceptedPeerIds.current.delete(peer.peerId);
    });

    const unsubscribeConnected = onConnected((peer) => {
      requestedPeerIds.current.delete(peer.peerId);
      acceptedPeerIds.current.delete(peer.peerId);

      setConnectedPeers((currentPeers) => {
        if (
          currentPeers.some((currentPeer) => currentPeer.peerId === peer.peerId)
        ) {
          return currentPeers;
        }

        const nextPeers = [...currentPeers, peer];
        setStatusText(getConnectionStatus(nextPeers));
        return nextPeers;
      });
    });

    const unsubscribeDisconnected = onDisconnected((peer) => {
      requestedPeerIds.current.delete(peer.peerId);
      acceptedPeerIds.current.delete(peer.peerId);

      setConnectedPeers((currentPeers) => {
        const nextPeers = currentPeers.filter(
          (currentPeer) => currentPeer.peerId !== peer.peerId
        );
        setStatusText(getConnectionStatus(nextPeers));
        return nextPeers;
      });
    });

    return () => {
      unsubscribePeerFound();
      unsubscribeInvitationReceived();
      unsubscribePeerLost();
      unsubscribeConnected();
      unsubscribeDisconnected();
    };
  }, [connectedPeers, deviceName]);

  useEffect(() => {
    return () => {
      disconnect().catch(() => {});
    };
  }, []);

  const handleSendText = useCallback(
    (messages: IMessage[]) => {
      if (connectedPeers.length === 0) {
        return;
      }

      Promise.allSettled(
        connectedPeers.map((peer) => sendText(peer.peerId, messages[0].text))
      ).then((results) => {
        const hasSuccessfulSend = results.some(
          (result) => result.status === "fulfilled"
        );

        if (hasSuccessfulSend) {
          setData((previousMessages) =>
            GiftedChat.append(previousMessages, messages)
          );
        }
      });
    },
    [connectedPeers, setData]
  );

  const handleRetry = useCallback(() => {
    requestedPeerIds.current.clear();
    acceptedPeerIds.current.clear();
    setConnectedPeers([]);
    setData([]);
    setStartupError(undefined);
    setStatusText("Requesting nearby permissions...");
    requestPermissionHandler().finally(() => {
      setRestartToken((value) => value + 1);
    });
  }, [requestPermissionHandler, setData]);

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <Header>Nearby Chat</Header>
      <View style={styles.topSection}>
        <Text style={styles.subtitle}>{statusText}</Text>
        <Text style={styles.metaLabel}>You are</Text>
        <Text style={styles.metaValue}>{deviceName}</Text>
        {myPeerId ? <Text style={styles.peerId}>{myPeerId}</Text> : null}
        {connectedPeers.length > 0 ? (
          <>
            <Text style={styles.metaLabel}>Connected peers</Text>
            <Text style={styles.metaValue}>{connectedPeers.length}</Text>
            <Text style={styles.peerList}>
              {connectedPeers.map((peer) => peer.name).join(", ")}
            </Text>
          </>
        ) : null}
        {startupError ? (
          <Text style={styles.errorText}>{startupError}</Text>
        ) : null}
      </View>

      {isConnected ? (
        <View style={[styles.chatWrapper, { paddingBottom: insets.bottom }]}>
          <GiftedChat
            messages={data}
            onSend={handleSendText}
            user={{ _id: myPeerId || deviceName, name: deviceName }}
            textInputProps={{
              autoCorrect: false,
            }}
          />
        </View>
      ) : (
        <View style={styles.waitingState}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.waitingTitle}>Waiting for someone nearby</Text>
          <Text style={styles.waitingText}>
            Open the app on another device and it will connect automatically.
          </Text>
          {!isGranted || startupError ? (
            <Button onPress={handleRetry}>Retry</Button>
          ) : null}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  topSection: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    gap: 6,
  },
  subtitle: {
    color: colors.greenDarker,
    fontSize: 15,
  },
  metaLabel: {
    color: colors.greenDarker,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 8,
    textTransform: "uppercase",
  },
  metaValue: {
    color: colors.greenDarker,
    fontSize: 18,
    fontWeight: "600",
  },
  peerId: {
    color: colors.greenDarker,
    fontSize: 12,
  },
  peerList: {
    color: colors.greenDarker,
    fontSize: 14,
    lineHeight: 20,
  },
  errorText: {
    color: "#c0392b",
    fontSize: 14,
    marginTop: 8,
  },
  chatWrapper: {
    flex: 1,
  },
  waitingState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 16,
  },
  waitingTitle: {
    color: colors.greenDarker,
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  waitingText: {
    color: colors.greenDarker,
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
});
