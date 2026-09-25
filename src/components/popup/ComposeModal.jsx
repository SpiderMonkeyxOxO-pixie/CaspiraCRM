
import React, { useState } from 'react';
import { Mail, Send, Inbox, Star, Archive, FileText, Trash, ChevronDown, Search, Reply, Forward, AtSign, X, Paperclip, Clock } from 'lucide-react';


// Compose Modal Component
function ComposeModal({ isOpen, onClose }) {
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [requestReceipt, setRequestReceipt] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const suggestions = [
    'nur.aisyah@internal',
    'lee.jun.hao@internal',
    'siti.zulaikha@internal',
    'arvind.raj@internal'
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg w-full max-w-4xl mx-4 shadow-2xl animate-slideUp">
        <div className="border-b border-gray-700 p-6">
          <h2 className="text-xl font-semibold text-white">New Internal Message</h2>
        </div>
        
        <div className="p-6 space-y-4">
          <div className="flex items-center space-x-4">
            <label className="text-gray-300 w-16">From</label>
            <input
              type="text"
              value="ahmad.faizal@internal"
              disabled
              className="flex-1 bg-gray-800 text-gray-400 px-4 py-3 rounded-lg border border-gray-700"
            />
          </div>

          <div className="flex items-center space-x-4 relative">
            <label className="text-gray-300 w-16">To</label>
            <div className="flex-1">
              <input
                type="text"
                placeholder="Enter receiver mail"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setShowSuggestions(e.target.value.length > 0);
                }}
                className="w-full bg-gray-800 text-white px-4 py-3 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500"
              />
              {showSuggestions && (
                <div className="absolute top-full left-16 right-0 mt-2 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-10">
                  <div className="p-2 text-sm text-gray-400">Suggestions:</div>
                  <div className="flex flex-wrap gap-2 p-2">
                    {suggestions.map((email) => (
                      <button
                        key={email}
                        onClick={() => {
                          setTo(email);
                          setShowSuggestions(false);
                        }}
                        className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-full transition-colors"
                      >
                        {email}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <label className="text-gray-300 w-16">Cc</label>
            <input
              type="text"
              placeholder="Optional"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              className="flex-1 bg-gray-800 text-gray-300 px-4 py-3 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center space-x-4">
            <label className="text-gray-300 w-16">Bcc</label>
            <input
              type="text"
              placeholder="Optional"
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
              className="flex-1 bg-gray-800 text-gray-300 px-4 py-3 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center space-x-4">
            <label className="text-gray-300 w-16">Subject</label>
            <input
              type="text"
              placeholder="Write a clear subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="flex-1 bg-gray-800 text-white px-4 py-3 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="pt-2">
            <div className="text-sm text-gray-400 mb-2">
              @ Mention teammates with @name # tag projects with #tag
            </div>
            <textarea
              placeholder="Write your message...."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full bg-gray-800 text-white px-4 py-3 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 min-h-[200px] resize-none"
            />
          </div>

          <div className="flex items-center justify-between pt-4">
            <div className="flex items-center space-x-4">
              <button className="flex items-center space-x-2 text-gray-300 hover:text-white transition-colors">
                <Clock className="w-5 h-5" />
                <span>Normal</span>
              </button>
              <button className="flex items-center space-x-2 text-gray-300 hover:text-white transition-colors">
                <Paperclip className="w-5 h-5" />
                <span>Add Attachment</span>
              </button>
            </div>

            <label className="flex items-center space-x-2 text-blue-400 cursor-pointer">
              <input
                type="checkbox"
                checked={requestReceipt}
                onChange={(e) => setRequestReceipt(e.target.checked)}
                className="w-4 h-4"
              />
              <span>Request read receipt</span>
            </label>
          </div>
        </div>

        <div className="border-t border-gray-700 p-6 flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

export default ComposeModal;