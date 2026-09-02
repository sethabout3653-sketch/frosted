import React, { useState, useEffect, useRef } from "react";
import { collection, query, orderBy, limit, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { ChatMessage, ChatProfile } from "../types";
import { Send, Image as ImageIcon, Smile, Paperclip, X, Trash2 } from "lucide-react";

// Giphy imports
import { GiphyFetch } from '@giphy/js-fetch-api';
import { Grid } from '@giphy/react-components';

const gf = new GiphyFetch('sXpGFDGpz0Dv1BASECkiIylQzntcxJW6');


interface ChatPanelProps {
  profile: ChatProfile;
}

export default function ChatPanel({ profile }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [showGiphy, setShowGiphy] = useState(false);
  const [attachment, setAttachment] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = query(
      collection(db, "messages"),
      orderBy("timestamp", "desc"),
      limit(50)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const newMessages: ChatMessage[] = [];
        snapshot.forEach((doc) => {
          newMessages.push({ id: doc.id, ...doc.data() } as ChatMessage);
        });
        setMessages(newMessages.reverse());
        setTimeout(() => scrollToBottom(), 100);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, "messages")
    );

    return () => unsubscribe();
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!text.trim() && !attachment) return;

    try {
      await addDoc(collection(db, "messages"), {
        uid: profile.uid,
        username: profile.username,
        photoURL: profile.photoURL,
        text: text.trim(),
        attachment,
        timestamp: Date.now(), // using client time as requested in simplified rules, but serverTimestamp() is better. Our rules say timestamp is number.
      });
      setText("");
      setAttachment(null);
    } catch (error) {
      console.error("Error sending message:", error);
    }
  };

  const handleSendGif = async (gif: any, e: React.SyntheticEvent<HTMLElement, Event>) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, "messages"), {
        uid: profile.uid,
        username: profile.username,
        photoURL: profile.photoURL,
        gif: gif.images.fixed_height.url,
        timestamp: Date.now(),
      });
      setShowGiphy(false);
    } catch (error) {
      console.error("Error sending GIF:", error);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.size > 2 * 1024 * 1024) {
        alert("File must be less than 2MB");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setAttachment(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDeleteMessage = async (msgId: string) => {
    try {
      await deleteDoc(doc(db, "messages", msgId));
    } catch (error) {
      console.error("Error deleting message:", error);
    }
  };

  const fetchGifs = (offset: number) => gf.trending({ offset, limit: 10 });

  return (
    <div className="flex flex-col h-full bg-black/95 backdrop-blur-xl border-l border-neutral-800">
      <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">General Chat</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => {
          const isMe = msg.uid === profile.uid || (msg.username === profile.username && msg.photoURL === profile.photoURL);
          return (
            <div key={msg.id} className={`flex gap-3 group ${isMe ? "flex-row-reverse" : ""}`}>
              <img src={msg.photoURL} alt={msg.username} className="w-8 h-8 rounded-full object-cover bg-neutral-800 flex-shrink-0" />
              <div className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                <span className="text-[10px] text-neutral-500 font-semibold mb-1">{msg.username}</span>
                <div className={`relative rounded-2xl px-4 py-2 max-w-[240px] ${isMe ? "bg-white text-black rounded-tr-sm" : "bg-neutral-800 text-white rounded-tl-sm"}`}>
                  {msg.text && <p className="text-sm break-words">{msg.text}</p>}
                  {msg.gif && <img src={msg.gif} alt="GIF" className="rounded-xl mt-2 max-w-full h-auto" />}
                  {msg.attachment && <img src={msg.attachment} alt="Attachment" className="rounded-xl mt-2 max-w-full h-auto" />}
                  
                  {isMe && (
                    <button
                      onClick={() => handleDeleteMessage(msg.id)}
                      className="absolute top-1/2 -translate-y-1/2 -left-8 p-1.5 text-neutral-500 hover:text-red-500 bg-neutral-900 rounded-full opacity-0 group-hover:opacity-100 transition-all border border-neutral-800 shadow-md"
                      title="Delete message"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {showGiphy && (
        <div className="h-64 overflow-y-auto border-t border-neutral-800 bg-neutral-900 p-2">
          <Grid width={300} columns={3} fetchGifs={fetchGifs} onGifClick={handleSendGif} />
        </div>
      )}

      {attachment && (
        <div className="p-2 border-t border-neutral-800 flex items-center gap-2">
          <div className="relative inline-block">
            <img src={attachment} alt="Preview" className="h-16 w-16 object-cover rounded-lg" />
            <button onClick={() => setAttachment(null)} className="absolute -top-2 -right-2 bg-black text-white rounded-full p-1 border border-neutral-700">
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSendMessage} className="p-3 border-t border-neutral-800 flex gap-2 items-center bg-black">
        <button type="button" onClick={() => fileInputRef.current?.click()} className="text-neutral-400 hover:text-white p-2">
          <Paperclip size={20} />
        </button>
        <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
        
        <button type="button" onClick={() => setShowGiphy(!showGiphy)} className="text-neutral-400 hover:text-white p-2">
          <Smile size={20} />
        </button>
        
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 bg-neutral-900 border border-neutral-800 text-white rounded-full px-4 py-2 text-sm outline-none focus:border-neutral-600"
        />
        
        <button type="submit" disabled={!text.trim() && !attachment} className="text-white bg-white/10 hover:bg-white/20 p-2 rounded-full disabled:opacity-50">
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
