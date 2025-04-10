// File: frontend/src/pages/CallSimulator.tsx
import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import io from 'socket.io-client';
import { MicrophoneIcon, StopIcon } from '@heroicons/react/24/solid';
import { useNavigate } from 'react-router-dom';

interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: Date;
  audioUrl?: string;
}

interface DemoAgent {
  name: string;
  company: string;
  personality: string;
}

interface StartConversationData {
  userId: string;
}

// Add helper function for time-based greeting
const getTimeBasedGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

// Add helper function for random warm greetings
const getRandomGreeting = () => {
  const greetings = [
    "Hi there! How can I brighten your day?",
    "Hello! I'm here to help make your day better.",
    "Hey! I'm excited to chat with you.",
    "Welcome! I'm looking forward to our conversation.",
    "Hi! I'm here to assist you with anything you need."
  ];
  return greetings[Math.floor(Math.random() * greetings.length)];
};

// Add message filtering helper
const filterMessages = (messages: Message[]) => {
  return messages.filter(message => message.role !== 'system');
};

// Add company-specific branding
const getCompanyBranding = (company: string) => {
  const defaultAvatar = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4z"/>
  </svg>`;
  
  const branding: { [key: string]: { color: string, name: string, bgColor: string, avatar: string } } = {
    'techcare solutions': {
      color: 'bg-blue-600',
      name: 'TechCare Solutions',
      bgColor: 'bg-blue-600',
      avatar: defaultAvatar
    },
    'general': {
      color: 'bg-blue-600',
      name: 'Customer Support',
      bgColor: 'bg-blue-600',
      avatar: defaultAvatar
    }
  };

  return branding[company] || branding['general'];
};

const CallSimulator: React.FC = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [demoAgent, setDemoAgent] = useState<DemoAgent | null>(null);
  
  const socketRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const navigate = useNavigate();

  // Add new state for ripple effect
  const [ripples, setRipples] = useState<{ id: number; scale: number }[]>([]);
  const rippleInterval = useRef<NodeJS.Timeout | null>(null);

  // Add new state for agent speaking animation
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);

  // Add state for current company
  const [currentCompany, setCurrentCompany] = useState<string>('general');

  // Connect to socket.io
  useEffect(() => {
    const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5001';
    socketRef.current = io(SOCKET_URL);

    socketRef.current.on('connect', () => {
      console.log('Connected to socket server');
    });

    socketRef.current.on('typing', (isTyping: boolean) => {
      setIsTyping(isTyping);
      setIsAgentSpeaking(isTyping);
    });

    socketRef.current.on('ai_response', (data: any) => {
      if (data.demoAgent) {
        setDemoAgent(data.demoAgent);
        setCurrentCompany(data.demoAgent.company.toLowerCase());
      }
      
      addMessage({
        id: Date.now().toString(),
        content: data.message,
        role: 'assistant',
        timestamp: new Date(),
        audioUrl: data.audioUrl
      });

      setIsProcessing(false);
      setIsTyping(false);
      
      // Start agent speaking animation
      setIsAgentSpeaking(true);
      
      // Play audio response
      if (data.audioUrl) {
        const audio = new Audio(`http://localhost:5001${data.audioUrl}`);
        audio.onended = () => setIsAgentSpeaking(false);
        audio.play();
      }
    });

    socketRef.current.on('conversation_started', (data: any) => {
      setConversationId(data.conversationId);
      if (data.demoAgent) {
        setDemoAgent(data.demoAgent);
        setCurrentCompany(data.demoAgent.company.toLowerCase());
      }
      if (data.welcomeMessage) {
        addMessage({
          id: Date.now().toString(),
          content: data.welcomeMessage.content,
          role: 'assistant',
          timestamp: new Date(),
          audioUrl: data.welcomeMessage.audioUrl
        });

        // Play welcome message audio
        if (data.welcomeMessage.audioUrl) {
          const audio = new Audio(`http://localhost:5001${data.welcomeMessage.audioUrl}`);
          audio.onended = () => setIsAgentSpeaking(false);
          setIsAgentSpeaking(true);
          audio.play();
        }
      }
    });

    socketRef.current.on('error', (error: any) => {
      console.error('Socket error:', error);
      setIsProcessing(false);
      setIsTyping(false);
    });

    socketRef.current.on('start_conversation', async (data: StartConversationData) => {
      try {
        const { userId } = data;
        
        if (!userId) {
          throw new Error('userId is required');
        }

        socketRef.current.emit('start_conversation', {
          userId,
          isCallSimulator: true
        });

      } catch (error) {
        console.error('Error starting conversation:', error);
        socketRef.current.emit('error', { message: 'Failed to start conversation' });
      }
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Create new conversation if needed
  useEffect(() => {
    if (!conversationId && user?._id) {
      console.log('Starting conversation with socket...');
      socketRef.current?.emit('start_conversation', {
        userId: user._id,
        isCallSimulator: true
      });
    }
  }, [conversationId, user]);

  const addMessage = (message: Message) => {
    setMessages(prev => [...prev, message]);
  };

  // Add ripple effect handlers
  const startRippleEffect = () => {
    if (rippleInterval.current) return;
    
    rippleInterval.current = setInterval(() => {
      setRipples(prev => {
        // Remove ripples that have expanded fully
        const filtered = prev.filter(r => r.scale < 2);
        
        // Add new ripple
        return [...filtered, { id: Date.now(), scale: 0 }].map(r => ({
          ...r,
          scale: r.scale + 0.1
        }));
      });
    }, 150);
  };

  const stopRippleEffect = () => {
    if (rippleInterval.current) {
      clearInterval(rippleInterval.current);
      rippleInterval.current = null;
    }
    setRipples([]);
  };

  // Modify recording handlers to include ripple effect
  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      startRippleEffect();
      
      // Set up speech recognition
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = true;
        recognitionRef.current.interimResults = true;
        
        recognitionRef.current.onresult = (event: any) => {
          const transcript = Array.from(event.results)
            .map((result: any) => result[0])
            .map(result => result.transcript)
            .join('');
          
          setInputMessage(transcript);
        };
        
        recognitionRef.current.start();
      }
      
      // Set up media recorder
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (e) => {
        audioChunksRef.current.push(e.data);
      };
      
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        
        if (inputMessage) {
          // Send both audio and transcript
          const formData = new FormData();
          formData.append('audio', audioBlob);
          formData.append('transcript', inputMessage);
          
          try {
            await axios.post(`http://localhost:5001/api/conversations/${conversationId}/audio`, formData, {
              headers: {
                'Content-Type': 'multipart/form-data'
              }
            });
            
            handleSendMessage();
          } catch (error) {
            console.error('Error sending audio:', error);
            // Fallback to text-only message
            handleSendMessage();
          }
        }
        
        // Stop tracks
        stream.getTracks().forEach(track => track.stop());
        
        // Stop speech recognition
        if (recognitionRef.current) {
          recognitionRef.current.stop();
        }
      };
      
      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('Could not access microphone. Please check your permissions.');
    }
  };

  const handleStopRecording = () => {
    stopRippleEffect();
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleSendMessage = () => {
    if (!inputMessage.trim() || !conversationId) return;
    
    // Create and add user message to the UI
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: inputMessage,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMessage]);
    
    // Send message to backend
    socketRef.current?.emit('user_message', {
      conversationId,
      message: inputMessage,
      isCallSimulator: true
    });
    
    // Clear input and set processing state
    setInputMessage('');
    setIsProcessing(true);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Clean up ripple effect on unmount
  useEffect(() => {
    return () => {
      if (rippleInterval.current) {
        clearInterval(rippleInterval.current);
      }
    };
  }, []);

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900">
      <div className="flex justify-between items-center p-4 bg-black/30 backdrop-blur-lg border-b border-white/10">
        <button
          onClick={() => navigate('/conversations')}
          className="text-white/80 hover:text-white flex items-center transition-all duration-300 hover:scale-105"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L4.414 9H17a1 1 0 110 2H4.414l5.293 5.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
          Back
        </button>
        <div className={`flex items-center px-6 py-2 rounded-full bg-black/40 backdrop-blur-md border border-white/20 shadow-lg transform transition-all duration-300 hover:scale-105 ${getCompanyBranding(currentCompany).color}`}>
          <div className="w-8 h-8 rounded-full overflow-hidden bg-black/30 p-1 mr-2 ring-2 ring-white/30">
            <div className="w-full h-full text-white" dangerouslySetInnerHTML={{ __html: getCompanyBranding(currentCompany).avatar }} />
          </div>
          <span className="text-lg font-medium text-white/90">
            {demoAgent ? `${demoAgent.name} - ${demoAgent.company}` : getCompanyBranding(currentCompany).name}
          </span>
        </div>
      </div>
      
      <div className="flex-1 max-w-5xl mx-auto p-4 w-full">
        <div className="bg-black/20 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/10 p-6 mb-4 h-[calc(100vh-180px)] flex flex-col">
          <div className="flex-1 overflow-y-auto mb-4 space-y-6 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent pr-4">
            {messages.map((message, index) => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} items-end space-x-3 animate-fadeIn`}
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                {message.role === 'assistant' && (
                  <div className={`relative w-10 h-10 rounded-full overflow-hidden flex-shrink-0 ${getCompanyBranding(demoAgent?.company.toLowerCase() || 'general').bgColor} ring-2 ring-white/30 animate-scaleIn`}>
                    <div className="w-full h-full p-1 text-white" dangerouslySetInnerHTML={{ __html: getCompanyBranding(demoAgent?.company.toLowerCase() || 'general').avatar }} />
                    {isAgentSpeaking && message.id === messages[messages.length - 1].id && (
                      <div className="absolute -bottom-1 -right-1 w-4 h-4">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-4 w-4 bg-green-500"></span>
                      </div>
                    )}
                  </div>
                )}
                
                <div className={`max-w-[80%] group transform transition-all duration-300 hover:scale-[1.02] ${message.role === 'user' ? 'ml-4' : 'mr-4'}`}>
                  <div className={`px-6 py-3 rounded-2xl backdrop-blur-md shadow-lg ${
                    message.role === 'user'
                      ? 'bg-blue-600/80 text-white rounded-br-sm border border-blue-400/30'
                      : 'bg-white/10 text-white/90 rounded-bl-sm border border-white/20'
                  } animate-slideIn`}>
                    <div className="flex items-center mb-2">
                      <span className={`text-sm font-medium ${message.role === 'user' ? 'text-blue-100' : 'text-white/80'}`}>
                        {message.role === 'user' ? 'You' : demoAgent ? `${demoAgent.name} - ${demoAgent.company}` : 'Assistant'}
                      </span>
                      <span className={`mx-2 text-xs ${message.role === 'user' ? 'text-blue-200' : 'text-white/50'}`}>•</span>
                      <span className={`text-xs ${message.role === 'user' ? 'text-blue-200' : 'text-white/50'}`}>
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                    {message.audioUrl && (
                      <div className="mt-3">
                        <audio
                          controls
                          className="w-full h-8 rounded-lg opacity-70 hover:opacity-100 transition-opacity duration-300"
                          onPlay={() => message.role === 'assistant' && setIsAgentSpeaking(true)}
                          onPause={() => setIsAgentSpeaking(false)}
                          onEnded={() => setIsAgentSpeaking(false)}
                        >
                          <source src={`http://localhost:5001${message.audioUrl}`} type="audio/mp3" />
                          Your browser does not support the audio element.
                        </audio>
                      </div>
                    )}
                  </div>
                </div>

                {message.role === 'user' && (
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex-shrink-0 flex items-center justify-center ring-2 ring-white/30 animate-scaleIn">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
            
            {isTyping && (
              <div className="flex justify-start items-end space-x-3 animate-fadeIn">
                <div className={`w-10 h-10 rounded-full overflow-hidden flex-shrink-0 ${getCompanyBranding(currentCompany).bgColor} ring-2 ring-white/30`}>
                  <div className="w-full h-full p-1 text-white" dangerouslySetInnerHTML={{ __html: getCompanyBranding(currentCompany).avatar }} />
                </div>
                <div className="bg-white/10 backdrop-blur-md rounded-2xl rounded-bl-sm px-6 py-4 border border-white/20">
                  <div className="flex space-x-2">
                    <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce delay-100"></div>
                    <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce delay-200"></div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="flex items-center space-x-3 bg-black/30 backdrop-blur-xl p-6 rounded-2xl border border-white/10">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your message..."
              className="flex-1 px-6 py-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition-all duration-300"
              disabled={isRecording || isProcessing}
            />
            
            <button
              onClick={handleSendMessage}
              disabled={!inputMessage.trim() || isProcessing || isRecording}
              className={`${
                !inputMessage.trim() || isProcessing || isRecording
                  ? 'bg-gray-600/50 cursor-not-allowed'
                  : 'bg-green-500/80 hover:bg-green-600/80 hover:scale-105'
              } text-white p-4 rounded-xl transition-all duration-300 transform flex items-center justify-center backdrop-blur-xl border border-white/20`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
              </svg>
            </button>
            
            <button
              onClick={isRecording ? handleStopRecording : handleStartRecording}
              disabled={isProcessing}
              className={`${
                isRecording
                  ? 'bg-red-500/80 hover:bg-red-600/80'
                  : 'bg-blue-500/80 hover:bg-blue-600/80'
              } text-white p-4 rounded-xl transition-all duration-300 transform hover:scale-105 flex items-center justify-center relative group backdrop-blur-xl border border-white/20 ${
                isProcessing ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {isRecording ? (
                <>
                  <div className="absolute inset-0 flex items-center justify-center">
                    {ripples.map(ripple => (
                      <span
                        key={ripple.id}
                        className="absolute inset-0 border-2 border-red-400/50 rounded-xl animate-ping"
                        style={{
                          transform: `scale(${ripple.scale})`,
                          opacity: 2 - ripple.scale,
                          transition: 'all 0.15s ease-out'
                        }}
                      />
                    ))}
                  </div>
                  <StopIcon className="h-5 w-5 relative z-10" />
                </>
              ) : (
                <MicrophoneIcon className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Add these styles to your global CSS or Tailwind config
const styles = `
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideIn {
  from { transform: translateY(10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@keyframes scaleIn {
  from { transform: scale(0.8); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

.animate-fadeIn {
  animation: fadeIn 0.5s ease-out forwards;
}

.animate-slideIn {
  animation: slideIn 0.3s ease-out forwards;
}

.animate-scaleIn {
  animation: scaleIn 0.3s ease-out forwards;
}
`;

export default CallSimulator;