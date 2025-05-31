import React, { useState, useEffect, useCallback, memo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, addDoc, setDoc, deleteDoc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';

// Firebase configuration.
// For PRODUCTION deployment on Render, these MUST be loaded from environment variables
// (e.env.REACT_APP_FB_API_KEY) for security and best practices.
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FB_API_KEY,
  authDomain: process.env.REACT_APP_FB_AUTH_DOMAIN,
  databaseURL: process.env.REACT_APP_FB_DATABASE_URL,
  projectId: process.env.REACT_APP_FB_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FB_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FB_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FB_APP_ID
};

// Use the Firebase App ID from the configuration for Firestore paths.
const appId = firebaseConfig.appId;

// Initialize Firebase App and Services outside the component to prevent re-initialization.
let app;
let db;
let auth;

try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
} catch (error) {
  console.error("Firebase initialization error:", error);
  // In a production app, you might render an error message to the user here.
}

// Main App component
function App() {
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [recipes, setRecipes] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [currentVideoId, setCurrentVideoId] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentView, setCurrentView] = useState('home');

  // Lifted state for Grocery List to App component for persistence across view changes
  const [groceryText, setGroceryText] = useState('');
  const [isGroceryListEditing, setIsGroceryListEditing] = useState(false);

  const categories = ['Breakfast', 'Lunch', 'Snacks', 'Dinner', 'Late-night'];

  // --- Utility Function: Display Toast Message (MOVED UP FOR INITIALIZATION) ---
  const showActionToast = useCallback((message) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => {
      setShowToast(false);
      setToastMessage('');
    }, 3000);
  }, []);

  // --- Firebase Authentication Setup ---
  useEffect(() => {
    if (!auth || !db) {
      console.error("Firebase not initialized. Cannot proceed with authentication or database operations.");
      return;
    }

    console.log("AppId being used for Firestore paths:", appId);

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        console.log("Authenticated user:", user.uid);
      } else {
        console.log("No user signed in. Attempting anonymous sign-in for shared access.");
        try {
          await signInAnonymously(auth);
        } catch (error) {
          console.error("Firebase anonymous sign-in failed:", error);
        }
      }
      setIsAuthReady(true);
    });

    return () => unsubscribeAuth();
  }, []);

  // --- Firestore Data Loading for Recipes ---
  useEffect(() => {
    if (!isAuthReady) return;

    console.log(`Attempting to subscribe to shared recipes.`);
    const recipesCollectionRef = collection(db, `artifacts/${appId}/recipes`);

    const unsubscribeRecipes = onSnapshot(recipesCollectionRef, (snapshot) => {
      const fetchedRecipes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRecipes(fetchedRecipes);
      console.log("Shared recipes fetched from Firestore:", fetchedRecipes);
    }, (error) => {
      console.error("Error fetching shared recipes from Firestore:", error);
      // This call now occurs after showActionToast is defined
      showActionToast('Failed to load recipes. Please check console for details.');
    });

    return () => unsubscribeRecipes();
  }, [isAuthReady, showActionToast]); // showActionToast added as dependency

  // --- Firestore Data Loading for Grocery List (now in App component) ---
  useEffect(() => {
    if (!isAuthReady) return;

    console.log(`Attempting to subscribe to shared grocery list.`);
    const groceryListDocRef = doc(db, `artifacts/${appId}/groceryList/myList`);

    const unsubscribeGroceryList = onSnapshot(groceryListDocRef, (docSnap) => {
      if (docSnap.exists()) {
        setGroceryText(docSnap.data().content || '');
        console.log("Shared grocery list fetched from Firestore:", docSnap.data().content);
      } else {
        // If the document doesn't exist, ensure the local state is also clear
        setGroceryText('');
        console.log("No shared grocery list found.");
      }
    }, (error) => {
      console.error("Error fetching shared grocery list from Firestore:", error);
      // This call now occurs after showActionToast is defined
      showActionToast('Failed to load grocery list. Please check console for details.');
    });

    return () => unsubscribeGroceryList();
  }, [isAuthReady, showActionToast]); // showActionToast is a dependency

  // --- Utility Function: Extract YouTube Video ID ---
  const getYoutubeVideoId = useCallback((url) => {
    let videoId = '';
    const youtubeRegex = /(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const shortsRegex = /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/;

    const match = url.match(youtubeRegex);
    const shortsMatch = url.match(shortsRegex);

    if (match && match[1]) {
      videoId = match[1];
    } else if (shortsMatch && shortsMatch[1]) {
      videoId = shortsMatch[1];
    }
    return videoId;
  }, []);

  // --- Utility Function: Generate YouTube Thumbnail URL ---
  const getYoutubeThumbnailUrl = useCallback((videoId) => {
    if (!videoId) return '';
    return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  }, []);

  // --- Handler: Add New Recipe to Firestore ---
  const handleAddRecipe = useCallback(async (newRecipe) => {
    if (!isAuthReady) {
      showActionToast('Application is loading. Please wait for authentication.');
      return;
    }
    try {
      const recipesCollectionRef = collection(db, `artifacts/${appId}/recipes`);
      await addDoc(recipesCollectionRef, newRecipe);
      requestAnimationFrame(() => {
        setTimeout(() => {
          showActionToast('Recipe Added!');
        }, 50);
      });
    } catch (error) {
      console.error("Error adding recipe to Firestore:", error);
      showActionToast('Failed to add recipe. Please check console.');
    }
  }, [isAuthReady, showActionToast]);

  // --- Handler: Delete Recipe from Firestore ---
  const handleDeleteRecipe = useCallback(async (videoIdToDelete) => {
    if (!isAuthReady) {
      showActionToast('Application is loading. Cannot delete.');
      return;
    }
    try {
      const recipesCollectionRef = collection(db, `artifacts/${appId}/recipes`);
      const q = query(recipesCollectionRef, where("videoId", "==", videoIdToDelete));
      const querySnapshot = await getDocs(q);
      if (!querySnapshot.empty) {
        const docToDelete = querySnapshot.docs[0];
        await deleteDoc(doc(db, `artifacts/${appId}/recipes`, docToDelete.id));
        showActionToast('Recipe Deleted!');
      } else {
        showActionToast('Recipe not found!');
      }
    } catch (error) {
      console.error("Error deleting recipe from Firestore:", error);
      showActionToast('Failed to delete recipe. Please check console.');
    }
  }, [isAuthReady, showActionToast]);

  // --- Handler: Save Grocery List to Firestore ---
  const handleSaveGroceryList = async () => {
    if (!isAuthReady) {
      showActionToast('Application is loading. Cannot save.');
      return;
    }
    try {
      const groceryListDocRef = doc(db, `artifacts/${appId}/groceryList/myList`);
      await setDoc(groceryListDocRef, { content: groceryText }, { merge: true });
      setIsGroceryListEditing(false); // Exit editing mode after saving
      showActionToast('Grocery List Saved!');
    } catch (error) {
      console.error('Failed to save grocery list to Firestore:', error);
      showActionToast('Failed to save grocery list. Please check console.');
    }
  };

  // --- Handler: Open Video Player Modal ---
  const openVideoModal = useCallback((videoId) => {
    setCurrentVideoId(videoId);
    setShowVideoModal(true);
  }, []);

  // --- Handler: Close Video Player Modal ---
  const closeVideoModal = useCallback(() => {
    setCurrentVideoId('');
    setShowVideoModal(false);
  }, []);

  // --- Component: Add Recipe Modal ---
  const AddRecipeModal = ({ onAddRecipe, onClose, getYoutubeVideoId, getYoutubeThumbnailUrl }) => { // Removed showActionToast prop
    const [youtubeUrl, setYoutubeUrl] = useState('');
    const [thumbnailUrl, setThumbnailUrl] = useState('');
    const [videoTitle, setVideoTitle] = useState('');
    const [selectedTags, setSelectedTags] = useState([]);
    const [isValidUrl, setIsValidUrl] = useState(false);
    const [isLoadingThumbnail, setIsLoadingThumbnail] = useState(false);
    const [isFetchingTitle, setIsFetchingTitle] = useState(false);

    // YouTube Data API Key - Loaded from environment variables for production.
    const YOUTUBE_API_KEY = process.env.REACT_APP_YOUTUBE_API_KEY;

    const resetForm = useCallback(() => {
      setYoutubeUrl('');
      setThumbnailUrl('');
      setVideoTitle('');
      setSelectedTags([]);
      setIsValidUrl(false);
      setIsLoadingThumbnail(false);
      setIsFetchingTitle(false);
    }, []);

    useEffect(() => {
      return () => {
        setTimeout(() => {
          resetForm();
        }, 1000);
      };
    }, [resetForm]);

    useEffect(() => {
        const handler = setTimeout(async () => {
            const videoId = getYoutubeVideoId(youtubeUrl);
            if (videoId) {
                setThumbnailUrl(getYoutubeThumbnailUrl(videoId));
                setIsValidUrl(true);
                setIsLoadingThumbnail(false);

                if (YOUTUBE_API_KEY) { // Only fetch if API key is present
                    setIsFetchingTitle(true);
                    try {
                        const response = await fetch(
                            `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${YOUTUBE_API_KEY}&part=snippet`
                        );
                        const data = await response.json();
                        if (data.items && data.items.length > 0) {
                            setVideoTitle(data.items[0].snippet.title);
                        } else {
                            setVideoTitle('Untitled Recipe (Video not found or private)');
                        }
                    } catch (error) {
                        console.error('Error fetching YouTube video title:', error);
                        setVideoTitle('Untitled Recipe (Error fetching title)');
                    } finally {
                        setIsFetchingTitle(false);
                    }
                } else {
                    setVideoTitle('Untitled Recipe (API Key missing)');
                }

            } else {
                setThumbnailUrl('');
                setVideoTitle('');
                setIsValidUrl(false);
                setIsLoadingThumbnail(false);
                setIsFetchingTitle(false);
            }
        }, 500);
        if (youtubeUrl) {
          setIsLoadingThumbnail(true);
          setIsFetchingTitle(true);
        }
        setVideoTitle('');
        return () => {
            clearTimeout(handler);
            setIsLoadingThumbnail(false);
            setIsFetchingTitle(false);
        };
    }, [youtubeUrl, getYoutubeVideoId, getYoutubeThumbnailUrl, YOUTUBE_API_KEY]);

    const handleTagChange = (tag) => {
      setSelectedTags((prevTags) =>
        prevTags.includes(tag) ? prevTags.filter((t) => t !== tag) : [...prevTags, tag]
      );
    };

    // Removed handlePaste function

    const handleSubmit = async (e) => {
      e.preventDefault();
      const videoId = getYoutubeVideoId(youtubeUrl);
      if (isValidUrl && videoId) {
        await onAddRecipe({
          youtubeUrl,
          videoId,
          thumbnailUrl,
          title: videoTitle || 'Untitled Recipe',
          tags: selectedTags.length > 0 ? selectedTags : categories,
        });
        onClose();
      }
    };

    return (
      <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4 z-50 font-inter">
        <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md relative animate-fade-in-up">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-500 hover:text-gray-800 text-2xl font-bold"
          >
            ×
          </button>
          <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">Add Recipe from YouTube</h2>
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label htmlFor="youtubeUrl" className="block text-gray-700 text-sm font-semibold mb-2">
                Paste Youtube Shorts or Video URL:
              </label>
              {/* Removed flex container and paste button */}
              <input
                type="text"
                id="youtubeUrl"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                className="shadow-sm appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200"
                placeholder="Paste YouTube URL here"
                required
              />
              {!isValidUrl && youtubeUrl && !isLoadingThumbnail && !isFetchingTitle && (
                <p className="text-red-500 text-xs mt-2">Please enter a valid YouTube URL.</p>
              )}
              {(isLoadingThumbnail || isFetchingTitle) && youtubeUrl && (
                 <p className="text-gray-500 text-xs mt-2">Getting video details...</p>
              )}
            </div>

            {isLoadingThumbnail && youtubeUrl && (
              <div className="mb-4 flex justify-center items-center h-32 bg-gray-100 rounded-lg animate-pulse">
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 border-4 border-t-4 border-blue-500 rounded-full animate-spin"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-gray-500 text-xs">Loading...</span>
                  </div>
                </div>
              </div>
            )}

            {thumbnailUrl && isValidUrl && !isLoadingThumbnail && (
              <div className="mb-6 text-center">
                <p className="text-gray-700 text-sm font-semibold mb-2">Thumbnail Preview:</p>
                <img
                  src={thumbnailUrl}
                  alt="Video Thumbnail"
                  className="w-full h-auto rounded-lg shadow-md border border-gray-200 object-cover transform transition-transform duration-300 hover:scale-105"
                  onError={(e) => { e.target.onerror = null; e.target.src = "https://placehold.co/480x360/E2E8F0/64748B?text=No+Thumbnail"; }}
                />
                <div className="mt-2 text-blue-600 font-medium">
                  {isFetchingTitle ? (
                    <div className="flex items-center justify-center space-x-2">
                        <div className="w-4 h-4 border-2 border-t-2 border-blue-500 rounded-full animate-spin"></div>
                        <span>Fetching title...</span>
                    </div>
                  ) : (
                    videoTitle || 'Untitled Recipe'
                  )}
                </div>
              </div>
            )}

            <div className="mb-6">
              <label className="block text-gray-700 text-sm font-semibold mb-2">
                Select Categories:
              </label>
              <div className="grid grid-cols-2 gap-2 text-gray-800">
                {categories.map((tag) => (
                  <label key={tag} className="inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      value={tag}
                      checked={selectedTags.includes(tag)}
                      onChange={() => handleTagChange(tag)}
                      className="form-checkbox h-5 w-5 text-blue-600 rounded-md focus:ring-blue-500 transition duration-150 ease-in-out"
                    />
                    <span className="ml-2 text-base">{tag}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={!isValidUrl || !youtubeUrl || isFetchingTitle}
              className={`w-full py-3 px-4 rounded-lg font-bold text-white transition duration-300 ${
                isValidUrl && youtubeUrl && !isFetchingTitle
                  ? 'bg-blue-600 hover:bg-blue-700 shadow-md transform hover:scale-105'
                  : 'bg-gray-400 cursor-not-allowed'
              }`}
            >
              {isFetchingTitle ? 'Fetching Title...' : 'Add Recipe'}
            </button>
          </form>
        </div>
      </div>
    );
  };

  // --- Component: Video Player Modal ---
  const VideoPlayerModal = memo(({ videoId, onClose, onAction, onDelete }) => {
    const handleDeleteClick = () => {
      onDelete(videoId);
      onClose();
    };

    return (
      <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4 z-50 font-inter">
        <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl relative animate-fade-in-up">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-500 hover:text-gray-800 text-2xl font-bold"
          >
            ×
          </button>
          <div className="aspect-w-16 aspect-h-9 mb-6 rounded-lg overflow-hidden shadow-lg">
            {videoId && (
              <iframe
                key={videoId}
                className="w-full h-full"
                src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`}
                title="YouTube video player"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              ></iframe>
            )}
          </div>
          <div className="flex justify-center items-center space-x-4 mb-4">
            <button
              onClick={() => {
                onAction('Go for it!');
                onClose();
              }}
              className="bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-6 rounded-full shadow-md transform transition-transform duration-200 hover:scale-105"
            >
              I will cook
            </button>
            <button
              onClick={() => {
                onAction('Go for it!');
                onClose();
              }}
              className="bg-purple-500 hover:bg-purple-600 text-white font-bold py-3 px-6 rounded-full shadow-md transform transition-transform duration-200 hover:scale-105"
            >
              I will order
            </button>
            <button
              onClick={handleDeleteClick}
              className="text-red-500 hover:text-red-700 p-2 rounded-full transition-colors duration-200 ml-4"
              title="Delete Recipe"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  });

  // --- Component: Toast Message ---
  const Toast = ({ message, show }) => {
    if (!show) return null;
    return (
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-6 py-3 rounded-full shadow-lg z-50 animate-fade-in-down">
        {message}
      </div>
    );
  };

  // --- Component: Grocery List ---
  // Now accepts groceryText and isEditing state from App component
  const GroceryList = ({ groceryText, setGroceryText, isEditing, setIsEditing, handleSave }) => {
    return (
      <div className="container mx-auto py-8 px-4">
        <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">Your Grocery List</h2>
        <div className="bg-white rounded-xl shadow-lg p-6">
          <textarea
            className={`w-full h-96 p-4 text-gray-800 rounded-lg border-2 ${
              isEditing ? 'border-blue-300' : 'border-gray-200'
            } resize-none transition-all duration-200 focus:outline-none ${ // Always remove default browser outline
              isEditing ? 'focus:ring-2 focus:ring-blue-500 focus:border-transparent' : '' // Apply custom focus ring only when editing
            }`}
            value={groceryText}
            onChange={(e) => setGroceryText(e.target.value)}
            readOnly={!isEditing} // Textarea is read-only when not editing
            placeholder="Start typing your grocery list here..."
          />
          <div className="mt-6 flex justify-center space-x-4">
            {isEditing ? (
              // Show Save button when in editing mode
              <button
                onClick={handleSave} // Use the passed handleSave
                className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-8 rounded-full shadow-md transform transition-transform duration-200 hover:scale-105"
              >
                Save Grocery List
              </button>
            ) : (
              // Show Edit button when not in editing mode
              <button
                onClick={() => setIsEditing(true)} // Set to editing mode on click
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-full shadow-md transform transition-transform duration-200 hover:scale-105"
              >
                Edit Grocery List
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const filteredRecipes = recipes.filter(recipe =>
    recipe.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 font-inter text-gray-900">
      {/* Header Section */}
      <header className="bg-white shadow-sm p-4 sticky top-0 z-10">
        <div className="container mx-auto flex flex-col sm:flex-row justify-between items-center">
          <div className="flex items-center space-x-4 mb-4 sm:mb-0">
            <h1 className="text-3xl font-extrabold text-blue-700 cursor-pointer" onClick={() => setCurrentView('home')}>RecipeFlow</h1>
            <button
              onClick={() => setCurrentView('groceryList')}
              className={`py-2 px-4 rounded-lg font-semibold transition-colors duration-200 ${
                currentView === 'groceryList' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Grocery List
            </button>
          </div>
          {currentView === 'home' && (
            <input
              type="text"
              placeholder="Search recipes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full sm:w-64 py-2 px-4 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
            />
          )}
        </div>
      </header>

      {/* Main Content Area - Conditional Rendering based on `currentView` */}
      <main>
        {/* Loading indicator while authentication is not ready */}
        {!isAuthReady && (
          <div className="flex flex-col items-center justify-center py-10">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
            <p className="text-gray-600 text-lg">Loading application...</p>
          </div>
        )}
        {isAuthReady && currentView === 'home' && (
          <div className="container mx-auto py-8 px-4">
            {/* New Dietary Advice Section */}
            <section className="mb-10 p-6 bg-white rounded-xl shadow-lg text-center">
              <h2 className="text-2xl font-bold text-gray-800 mb-3">Your Healthy Plate & Daily Habits</h2>
              <p className="text-gray-700 text-lg leading-relaxed">
                Aim for a balanced plate with <span className="font-semibold text-green-600">Fibre</span>,
                <span className="font-semibold text-blue-600"> Protein</span>,
                <span className="font-semibold text-yellow-600"> Complex Carbs</span>, and
                <span className="font-semibold text-purple-600"> Healthy Fats</span>.
                Include 4-5 servings of nuts and fruits. Drink 8 glasses of water daily.
                Limit highly processed foods, sugary drinks, and deep-fried items.
              </p>
            </section>

            {/* Iterate through categories and display recipes */}
            {categories.map((category) => (
              <section key={category} className="mb-10">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">{category}</h2>
                <div className="flex overflow-x-auto space-x-4 pb-4 scrollbar-hide">
                  {/* Filter and map recipes belonging to the current category */}
                  {filteredRecipes.filter((recipe) => recipe.tags.includes(category)).length > 0 ? (
                    filteredRecipes
                      .filter((recipe) => recipe.tags.includes(category))
                      .map((recipe) => (
                        <div
                          key={recipe.id}
                          className="flex-none w-48 h-48 bg-white rounded-lg shadow-md overflow-hidden cursor-pointer"
                          onClick={() => openVideoModal(recipe.videoId)}
                        >
                          <img
                            src={recipe.thumbnailUrl}
                            alt={recipe.title}
                            className="w-full h-3/4 object-cover"
                            onError={(e) => { e.target.onerror = null; e.target.src = "https://placehold.co/192x144/E2E8F0/64748B?text=No+Thumbnail"; }}
                          />
                          <div className="p-2 text-sm font-semibold text-center line-clamp-2">
                            {recipe.title}
                          </div>
                        </div>
                      ))
                  ) : (
                    <div className="text-gray-500 text-lg p-4 bg-white rounded-lg shadow-sm w-full text-center">
                      No recipes in this category yet. Click '+' to add one!
                    </div>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}

        {isAuthReady && currentView === 'groceryList' && (
          <GroceryList
            groceryText={groceryText}
            setGroceryText={setGroceryText}
            isEditing={isGroceryListEditing}
            setIsEditing={setIsGroceryListEditing}
            handleSave={handleSaveGroceryList}
          />
        )}
      </main>

      {/* Floating "Add Recipe" Button (only visible on the home view) */}
      {currentView === 'home' && (
        <button
          onClick={() => setShowAddModal(true)}
          className="fixed bottom-8 right-8 bg-blue-600 hover:bg-blue-700 text-white rounded-full p-4 shadow-lg text-3xl font-bold flex items-center justify-center w-16 h-16 transform transition-transform duration-200 hover:scale-110 focus:outline-none focus:ring-4 focus:ring-300"
          aria-label="Add New Recipe"
        >
          +
        </button>
      )}


      {/* Modals and Toast Notifications */}
      {showAddModal && (
        <AddRecipeModal
          onAddRecipe={handleAddRecipe}
          onClose={() => setShowAddModal(false)}
          getYoutubeVideoId={getYoutubeVideoId}
          getYoutubeThumbnailUrl={getYoutubeThumbnailUrl}
          // Removed showActionToast prop as it's no longer needed in AddRecipeModal
        />
      )}
      {showVideoModal && (
        <VideoPlayerModal
          videoId={currentVideoId}
          onClose={closeVideoModal}
          onAction={showActionToast}
          onDelete={handleDeleteRecipe}
        />
      )}
      <Toast message={toastMessage} show={showToast} />

      {/* Global CSS Styles for Scrollbar and Animations */}
      <style>{`
        .scrollbar-hide::-webkit-scrollbar {
            display: none;
        }
        .scrollbar-hide {
            -ms-overflow-style: none; /* IE and Edge */
            scrollbar-width: none; /* Firefox */
        }
        @keyframes fade-in-up {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in-up {
          animation: fade-in-up 0.3s ease-out forwards;
        }
        @keyframes fade-in-down {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes bounce-once {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-5px);
          }
        }
        .animate-bounce-once {
          animation: bounce-once 0.5s ease-in-out;
        }
        body {
          font-family: 'Inter', sans-serif;
        }
      `}</style>
    </div>
  );
}

export default App;
