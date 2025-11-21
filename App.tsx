import React from 'react';
import { CalendarComposer } from './components/CalendarComposer';
import { Layout, Image as ImageIcon, Calendar as CalendarIcon } from 'lucide-react';

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <CalendarIcon className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Calendar Studio</h1>
          </div>
          <div className="text-sm text-gray-500 hidden sm:block">
            Create professional personalized calendars
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
           <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden min-h-[600px]">
             <CalendarComposer />
           </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 text-center text-gray-400 text-sm">
          &copy; {new Date().getFullYear()} Calendar Studio. Secure local processing.
        </div>
      </footer>
    </div>
  );
};

export default App;