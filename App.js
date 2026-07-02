import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  Platform,
  StatusBar,
} from "react-native";
import { Audio } from "expo-av";
// SDK 54 replaced the default expo-file-system API with a new object-oriented
// one. We use the "/legacy" import to keep the simple readAsStringAsync /
// writeAsStringAsync API used below.
import * as FileSystem from "expo-file-system/legacy";
import { io } from "socket.io-client";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";

// ------------------------------------------------------------------
// EDIT THIS if you want a default server address pre-filled.
// It must be your computer's LAN IP (not "localhost") when testing
// on a physical phone with Expo Go, e.g. "http://192.168.1.20:3001"
// ------------------------------------------------------------------
const DEFAULT_SERVER_URL = "https://walkie-talkie-backend-1.onrender.com";

export default function App() {
  const [screen, setScreen] = useState("join"); // "join" | "channel"
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [username, setUsername] = useState("");
  const [channelName, setChannelName] = useState("general");

  const [connected, setConnected] = useState(false);
  const [users, setUsers] = useState([]);
  const [speakingUser, setSpeakingUser] = useState(null); // remote user currently talking
  const [isRecording, setIsRecording] = useState(false);
  const [messages, setMessages] = useState([]); // system log

  const socketRef = useRef(null);
  const recordingRef = useRef(null);
  const soundRef = useRef(null);

  // ---------------- Audio permissions & mode ----------------
  useEffect(() => {
    (async () => {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Microphone permission needed",
          "Please allow microphone access to use push-to-talk."
        );
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });
    })();
  }, []);

  // ---------------- Connect to server ----------------
  const connect = useCallback(() => {
    if (!serverUrl.trim() || !username.trim() || !channelName.trim()) {
      Alert.alert("Missing info", "Please fill in server URL, name, and channel.");
      return;
    }

    const socket = io(DEFAULT_SERVER_URL, {
      transports: ["websocket"],
      reconnectionAttempts: 5,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join", { username: username.trim(), channel: channelName.trim() });
      setScreen("channel");
    });

    socket.on("connect_error", (err) => {
      Alert.alert("Connection failed", `Could not reach ${serverUrl}.\n${err.message}`);
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("user-list", (list) => setUsers(list));

    socket.on("system-message", (msg) => {
      setMessages((prev) => [...prev.slice(-20), msg]);
    });

    socket.on("speaking-start", ({ username: who }) => setSpeakingUser(who));
    socket.on("speaking-end", () => setSpeakingUser(null));

    socket.on("audio", async ({ audio, mimeType, username: who }) => {
      try {
        const ext = mimeType && mimeType.includes("m4a") ? "m4a" : "m4a";
        const fileUri = `${FileSystem.cacheDirectory}incoming-${Date.now()}.${ext}`;
        await FileSystem.writeAsStringAsync(fileUri, audio, {
          encoding: FileSystem.EncodingType.Base64,
        });

        if (soundRef.current) {
          await soundRef.current.unloadAsync();
          soundRef.current = null;
        }
        const { sound } = await Audio.Sound.createAsync(
          { uri: fileUri },
          { shouldPlay: true }
        );
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.didJustFinish) {
            sound.unloadAsync();
          }
        });
      } catch (e) {
        console.warn("Failed to play incoming audio", e);
      }
    });
  }, [serverUrl, username, channelName]);

  const disconnect = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setConnected(false);
    setUsers([]);
    setMessages([]);
    setScreen("join");
  }, []);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  // ---------------- Push to talk: recording ----------------
  const startRecording = useCallback(async () => {
    try {
      if (recordingRef.current) return;
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setIsRecording(true);
      socketRef.current?.emit("speaking-start");
    } catch (e) {
      console.warn("Failed to start recording", e);
    }
  }, []);

  const stopRecordingAndSend = useCallback(async () => {
    try {
      const recording = recordingRef.current;
      if (!recording) return;
      recordingRef.current = null;
      setIsRecording(false);
      socketRef.current?.emit("speaking-end");

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (!uri) return;

      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      socketRef.current?.emit("audio", {
        audio: base64,
        mimeType: "audio/m4a",
      });
    } catch (e) {
      console.warn("Failed to stop/send recording", e);
    }
  }, []);

  // ------------------------------------------------------------------
  // JOIN SCREEN
  // ------------------------------------------------------------------
  if (screen === "join") {
    return (
      <SafeAreaView style={styles.safe}>
        <ExpoStatusBar style="light" />
        <View style={styles.joinContainer}>
          <Text style={styles.title}>📻 Walkie Talkie</Text>
          <Text style={styles.subtitle}>Push-to-talk over your own server</Text>

          <Text style={styles.label}>Server URL</Text>
          <TextInput
            style={styles.input}
            placeholder="https://walkie-talkie-backend-1.onrender.com"
            placeholderTextColor="#888"
            autoCapitalize="none"
            autoCorrect={false}
            value={DEFAULT_SERVER_URL}
            editable={false}
            selectTextOnFocus={false}
          />

          <Text style={styles.label}>Your name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Alex"
            placeholderTextColor="#888"
            autoCapitalize="none"
            value={username}
            onChangeText={setUsername}
          />

          <Text style={styles.label}>Channel</Text>
          <TextInput
            style={styles.input}
            placeholder="general"
            placeholderTextColor="#888"
            autoCapitalize="none"
            value={channelName}
            onChangeText={setChannelName}
          />

          <TouchableOpacity style={styles.joinButton} onPress={connect}>
            <Text style={styles.joinButtonText}>Join Channel</Text>
          </TouchableOpacity>

          <Text style={styles.hint}>
            Tip: run the backend on your computer, find its LAN IP (e.g. via{" "}
            {Platform.OS === "ios" ? "ifconfig" : "ipconfig"}), and use{" "}
            http://YOUR_IP:3001 here. Your phone and computer must be on the
            same Wi-Fi network.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ------------------------------------------------------------------
  // CHANNEL / WALKIE-TALKIE SCREEN
  // ------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.safe}>
      <ExpoStatusBar style="light" />
      <View style={styles.header}>
        <View>
          <Text style={styles.channelTitle}>#{channelName}</Text>
          <Text style={styles.connectionStatus}>
            {connected ? "🟢 Connected" : "🔴 Disconnected"}
          </Text>
        </View>
        <TouchableOpacity style={styles.leaveButton} onPress={disconnect}>
          <Text style={styles.leaveButtonText}>Leave</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.usersSection}>
        <Text style={styles.sectionLabel}>Online ({users.length})</Text>
        <FlatList
          data={users}
          horizontal
          keyExtractor={(item, idx) => item + idx}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <View
              style={[
                styles.userChip,
                speakingUser === item && styles.userChipSpeaking,
              ]}
            >
              <Text style={styles.userChipText}>
                {item === username ? `${item} (you)` : item}
              </Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No one else here yet</Text>
          }
        />
      </View>

      <View style={styles.speakingIndicator}>
        {speakingUser ? (
          <Text style={styles.speakingText}>🔊 {speakingUser} is talking…</Text>
        ) : (
          <Text style={styles.speakingTextIdle}>Channel is quiet</Text>
        )}
      </View>

      <View style={styles.pttContainer}>
        <TouchableOpacity
          style={[styles.pttButton, isRecording && styles.pttButtonActive]}
          onPressIn={startRecording}
          onPressOut={stopRecordingAndSend}
          activeOpacity={0.8}
        >
          <Text style={styles.pttButtonText}>
            {isRecording ? "Release to Send" : "Hold to Talk"}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.logSection}>
        {messages.slice(-4).map((m, i) => (
          <Text key={i} style={styles.logText}>
            • {m}
          </Text>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#1c1c1e",
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0,
  },
  joinContainer: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "center",
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: "#fff",
    textAlign: "center",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "#9a9a9e",
    textAlign: "center",
    marginBottom: 32,
  },
  label: {
    color: "#c7c7cc",
    fontSize: 13,
    marginBottom: 6,
    marginTop: 14,
  },
  input: {
    backgroundColor: "#2c2c2e",
    color: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  joinButton: {
    backgroundColor: "#ff9500",
    borderRadius: 12,
    paddingVertical: 16,
    marginTop: 28,
    alignItems: "center",
  },
  joinButtonText: {
    color: "#1c1c1e",
    fontSize: 17,
    fontWeight: "700",
  },
  hint: {
    color: "#7d7d82",
    fontSize: 12,
    marginTop: 20,
    lineHeight: 18,
    textAlign: "center",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  channelTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
  },
  connectionStatus: {
    color: "#9a9a9e",
    fontSize: 12,
    marginTop: 2,
  },
  leaveButton: {
    backgroundColor: "#3a3a3c",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  leaveButtonText: {
    color: "#ff453a",
    fontWeight: "600",
  },
  usersSection: {
    paddingHorizontal: 20,
    marginTop: 16,
  },
  sectionLabel: {
    color: "#9a9a9e",
    fontSize: 12,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  userChip: {
    backgroundColor: "#2c2c2e",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  userChipSpeaking: {
    backgroundColor: "#34c759",
  },
  userChipText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "500",
  },
  emptyText: {
    color: "#636366",
    fontSize: 13,
  },
  speakingIndicator: {
    alignItems: "center",
    marginTop: 20,
  },
  speakingText: {
    color: "#34c759",
    fontSize: 15,
    fontWeight: "600",
  },
  speakingTextIdle: {
    color: "#636366",
    fontSize: 14,
  },
  pttContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pttButton: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "#ff9500",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#ff9500",
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },
  pttButtonActive: {
    backgroundColor: "#ff453a",
    transform: [{ scale: 1.05 }],
  },
  pttButtonText: {
    color: "#1c1c1e",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
    paddingHorizontal: 20,
  },
  logSection: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    minHeight: 90,
  },
  logText: {
    color: "#636366",
    fontSize: 12,
    marginBottom: 2,
  },
});
