import React, { useState, useEffect, useCallback, memo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, addDoc, setDoc, deleteDoc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';

// Retrieve Firebase configuration from environment variables.
// These variables should be set on your hosting platform (e.g., Render)
// with the 'REACT_APP_' prefix for Create React App compatibility.
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
// This ensures consistency between your Firebase project's app ID and the Firestore data paths.
const appId = firebaseConfig.appId;

// initialAuthToken is a Canvas-specific global and is not used when Firebase config
// is provided via environment variables for a standard React deployment.
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;


// Initialize Firebase App and Services outside the component to prevent re-initialization.
// This ensures Firebase is initialized only once when the application loads.
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
  // State to track if Firebase authentication is ready.
  // This is crucial to ensure Firestore operations are only attempted after authentication.
  const [isAuthReady, setIsAuthReady] = useState(false);

  // State to hold the list of recipes fetched from Firestore.
  const [recipes, setRecipes] = useState([]);
  // State to control the visibility of the "Add Recipe" modal.
  const [showAddModal, setShowAddModal] = useState(false);
  // State to control the visibility of the "Video Player" modal.
  const [showVideoModal, setShowVideoModal] = useState(false);
  // State to store the YouTube video ID for the currently playing video.
  const [currentVideoId, setCurrentVideoId] = useState('');
  // State for displaying temporary toast messages to the user.
  const [toastMessage, setToastMessage] = useState('');
  // State to control the visibility of the toast message.
  const [showToast, setShowToast] = useState(false);
  // State for the search term entered by the user to filter recipes.
  const [searchTerm, setSearchTerm] = useState('');
  // State to manage the current view: 'home' for recipes or 'groceryList' for the grocery list.
  const [currentView, setCurrentView] = useState('home');

  // Predefined categories for recipes, used for tagging and display.
  const categories = ['Breakfast', 'Lunch', 'Snacks', 'Dinner', 'Late-night'];

  // --- Firebase Authentication Setup ---
  // This useEffect hook handles Firebase authentication.
  // It attempts to sign in the user anonymously if no user is signed in.
  // The `isAuthReady` state ensures that Firestore operations wait for authentication.
  useEffect(() => {
    if (!auth || !db) {
      console.error("Firebase not initialized. Cannot proceed with authentication or database operations.");
      return;
    }

    // Log the appId being used for Firestore paths to help with rule debugging
    console.log("AppId being used for Firestore paths:", appId);

    // `onAuthStateChanged` listens for changes in the user's sign-in state.
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // User is signed in (could be a new anonymous user or an existing one).
        console.log("Authenticated user:", user.uid);
      } else {
        // No user is signed in, attempt anonymous sign-in.
        console.log("No user signed in. Attempting anonymous sign-in for shared access.");
        try {
          // Use signInWithCustomToken if provided, otherwise signInAnonymously.
          // For this shared data model, anonymous sign-in is sufficient.
          if (initialAuthToken) { // initialAuthToken is for Canvas environment primarily
            await signInAnonymously(auth);
          } else {
            await signInAnonymously(auth);
          }
        } catch (error) {
          console.error("Firebase anonymous sign-in failed:", error);
          // If anonymous sign-in fails, the app might not be able to interact with Firestore.
          // In a real app, you might show a persistent error message to the user.
        }
      }
      setIsAuthReady(true); // Authentication state is now determined.
    });

    // Cleanup function: unsubscribe from the auth state listener when the component unmounts.
    return () => unsubscribeAuth();
  }, []); // Empty dependency array ensures this runs only once on component mount.

  // --- Firestore Data Loading for Recipes ---
  // This useEffect hook sets up a real-time listener for recipes from Firestore.
  // It depends on `isAuthReady` to ensure authentication is complete before fetching data.
  useEffect(() => {
    if (!isAuthReady) return; // Wait for authentication to be ready.

    console.log(`Attempting to subscribe to shared recipes.`);
    // IMPORTANT: The Firestore path is now shared across all users.
    // Data is stored in `artifacts/${appId}/recipes` instead of `artifacts/${appId}/users/${userId}/recipes`.
    const recipesCollectionRef = collection(db, `artifacts/${appId}/recipes`);

    // `onSnapshot` provides real-time updates to the `recipes` state.
    const unsubscribeRecipes = onSnapshot(recipesCollectionRef, (snapshot) => {
      const fetchedRecipes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRecipes(fetchedRecipes);
      console.log("Shared recipes fetched from Firestore:", fetchedRecipes);
    }, (error) => {
      console.error("Error fetching shared recipes from Firestore:", error);
      showActionToast('Failed to load recipes. Please check console for details.');
    });

    // Cleanup function: unsubscribe from the Firestore listener when the component unmounts.
    return () => unsubscribeRecipes();
  }, [isAuthReady]); // Re-run when `isAuthReady` changes.

  // --- Utility Function: Extract YouTube Video ID ---
  // Extracts the 11-character YouTube video ID from various YouTube URL formats (including Shorts).
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
  // Generates a high-quality YouTube thumbnail URL from a given video ID.
  const getYoutubeThumbnailUrl = useCallback((videoId) => {
    if (!videoId) return '';
    return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  }, []);

  // --- Utility Function: Display Toast Message ---
  // Shows a temporary toast notification at the bottom of the screen.
  const showActionToast = useCallback((message) => {
    setToastMessage(message);
    setShowToast(true);
    // Automatically hide the toast after 3 seconds.
    setTimeout(() => {
      setShowToast(false);
      setToastMessage('');
    }, 3000);
  }, []);

  // --- Handler: Add New Recipe to Firestore ---
  // Adds a new recipe document to the shared Firestore 'recipes' collection.
  const handleAddRecipe = useCallback(async (newRecipe) => {
    if (!isAuthReady) {
      showActionToast('Application is loading. Please wait for authentication.');
      return;
    }
    try {
      // IMPORTANT: Using the shared Firestore path.
      const recipesCollectionRef = collection(db, `artifacts/${appId}/recipes`);
      await addDoc(recipesCollectionRef, newRecipe);
      // Delay toast slightly to allow modal dismissal animation to start smoothly.
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
  // Deletes a recipe document from the shared Firestore 'recipes' collection.
  const handleDeleteRecipe = useCallback(async (videoIdToDelete) => {
    if (!isAuthReady) {
      showActionToast('Application is loading. Cannot delete.');
      return;
    }
    try {
      // IMPORTANT: Using the shared Firestore path.
      const recipesCollectionRef = collection(db, `artifacts/${appId}/recipes`);
      // Query to find the document by its `videoId` field.
      const q = query(recipesCollectionRef, where("videoId", "==", videoIdToDelete));
      const querySnapshot = await getDocs(q);
      if (!querySnapshot.empty) {
        // If a matching document is found, delete it.
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
  const AddRecipeModal = ({ onAddRecipe, onClose, getYoutubeVideoId, getYoutubeThumbnailUrl }) => {
    const [youtubeUrl, setYoutubeUrl] = useState('');
    const [thumbnailUrl, setThumbnailUrl] = useState('');
    const [videoTitle, setVideoTitle] = useState('');
    const [selectedTags, setSelectedTags] = useState([]);
    const [isValidUrl, setIsValidUrl] = useState(false);
    const [isLoadingThumbnail, setIsLoadingThumbnail] = useState(false);
    const [isFetchingTitle, setIsFetchingTitle] = useState(false);

    // YouTube Data API Key - now accessed from environment variables.
    const YOUTUBE_API_KEY = process.env.REACT_APP_YOUTUBE_API_KEY;

    // Function to reset all form fields to their initial empty state.
    const resetForm = useCallback(() => {
      setYoutubeUrl('');
      setThumbnailUrl('');
      setVideoTitle('');
      setSelectedTags([]);
      setIsValidUrl(false);
      setIsLoadingThumbnail(false);
      setIsFetchingTitle(false);
    }, []);

    // Effect to reset form when the modal component unmounts (i.e., when it closes).
    // This ensures the form is clean the next time it opens.
    useEffect(() => {
      return () => {
        // Reset form 1 second after the modal component unmounts (visually disappears).
        setTimeout(() => {
          resetForm();
        }, 1000); // 1 second delay
      };
    }, [resetForm]);

    // Effect to fetch YouTube video details (thumbnail and title) as the user types the URL.
    // Includes a debounce to prevent excessive API calls.
    useEffect(() => {
        const handler = setTimeout(async () => {
            const videoId = getYoutubeVideoId(youtubeUrl);
            if (videoId) {
                setThumbnailUrl(getYoutubeThumbnailUrl(videoId));
                setIsValidUrl(true);
                setIsLoadingThumbnail(false);

                // Only attempt to fetch title if API key is available
                if (YOUTUBE_API_KEY) {
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
        }, 500); // Debounce time: 500ms
        if (youtubeUrl) {
          setIsLoadingThumbnail(true);
          setIsFetchingTitle(true);
        }
        setVideoTitle(''); // Clear title immediately when URL changes
        return () => {
            clearTimeout(handler); // Clear timeout if URL changes before delay
            setIsLoadingThumbnail(false);
            setIsFetchingTitle(false);
        };
    }, [youtubeUrl, getYoutubeVideoId, getYoutubeThumbnailUrl, YOUTUBE_API_KEY]);

    // Handles the form submission for adding a new recipe.
    const handleTagChange = (tag) => {
      setSelectedTags((prevTags) =>
        prevTags.includes(tag) ? prevTags.filter((t) => t !== tag) : [...prevTags, tag]
      );
    };

    const handleSubmit = async (e) => {
      e.preventDefault();
      const videoId = getYoutubeVideoId(youtubeUrl);
      if (isValidUrl && videoId) {
        await onAddRecipe({ // Call parent's handler to add recipe to Firestore
          youtubeUrl,
          videoId,
          thumbnailUrl,
          title: videoTitle || 'Untitled Recipe',
          tags: selectedTags.length > 0 ? selectedTags : categories,
        });
        // Form fields are reset by the useEffect cleanup when the modal closes.
        onClose(); // Close the modal immediately after successful data handling.
      }
    };

    return (
      <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4 z-50 font-inter">
        <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md relative animate-fade-in-up">
          <button
            onClick={onClose} // Simply call onClose; useEffect handles form reset on unmount.
            className="absolute top-4 right-4 text-gray-500 hover:text-gray-800 text-2xl font-bold"
          >
            ×
          </button>
          <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">Add New Recipe</h2>
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label htmlFor="youtubeUrl" className="block text-gray-700 text-sm font-semibold mb-2">
                YouTube Shorts URL:
              </label>
              <input
                type="text"
                id="youtubeUrl"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                className="shadow-sm appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200"
                placeholder="Paste YouTube URL here"
                required
              />
              {/* Conditional messages based on URL validity and loading state */}
              {!isValidUrl && youtubeUrl && !isLoadingThumbnail && !isFetchingTitle && (
                <p className="text-red-500 text-xs mt-2">Please enter a valid YouTube URL.</p>
              )}
              {(isLoadingThumbnail || isFetchingTitle) && youtubeUrl && (
                 <p className="text-gray-500 text-xs mt-2">Getting video details...</p>
              )}
            </div>

            {/* Loading indicator for thumbnail/title fetch */}
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

            {/* Category selection checkboxes */}
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

            {/* Submit button for adding recipe */}
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
  // Memoized to prevent unnecessary re-renders, improving performance.
  const VideoPlayerModal = memo(({ videoId, onClose, onAction, onDelete }) => {
    // Handler for deleting the current video.
    const handleDeleteClick = () => {
      onDelete(videoId); // Call parent's delete handler
      onClose(); // Close the modal
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
                key={videoId} // Key ensures iframe re-renders only when videoId changes, preventing reloads.
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
  const GroceryList = () => {
    const [groceryText, setGroceryText] = useState('');
    const [isEditing, setIsEditing] = useState(false);

    // Effect to load grocery list from Firestore (using a shared path).
    useEffect(() => {
      if (!isAuthReady) return; // Wait for authentication to be ready.

      console.log(`Attempting to subscribe to shared grocery list.`);
      // IMPORTANT: The Firestore path is now shared across all users.
      // Data is stored in `artifacts/${appId}/groceryList/myList`.
      const groceryListDocRef = doc(db, `artifacts/${appId}/groceryList/myList`);

      // `onSnapshot` provides real-time updates to the `groceryText` state.
      const unsubscribeGroceryList = onSnapshot(groceryListDocRef, (docSnap) => {
        if (docSnap.exists()) {
          setGroceryText(docSnap.data().content || '');
          console.log("Shared grocery list fetched from Firestore:", docSnap.data().content);
        } else {
          setGroceryText(''); // If no document exists, the list is empty.
          console.log("No shared grocery list found.");
        }
      }, (error) => {
        console.error("Error fetching shared grocery list from Firestore:", error);
        showActionToast('Failed to load grocery list. Please check console for details.');
      });

      // Cleanup function: unsubscribe from the Firestore listener when the component unmounts.
      return () => unsubscribeGroceryList();
    }, [isAuthReady]); // Re-run when `isAuthReady` changes.

    // Handler to save the grocery list text to Firestore.
    const handleSave = async () => {
      if (!isAuthReady) {
        showActionToast('Application is loading. Cannot save.');
        return;
      }
      try {
        // IMPORTANT: Using the shared Firestore path.
        const groceryListDocRef = doc(db, `artifacts/${appId}/groceryList/myList`);
        // `setDoc` with `merge: true` will create the document if it doesn't exist
        // or update it without overwriting other fields if they exist.
        await setDoc(groceryListDocRef, { content: groceryText }, { merge: true });
        setIsEditing(false);
        showActionToast('Grocery List Saved!');
      } catch (error) {
        console.error('Failed to save grocery list to Firestore:', error);
        showActionToast('Failed to save grocery list. Please check console.');
      }
    };

    return (
      <div className="container mx-auto py-8 px-4">
        <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">Your Grocery List</h2>
        <div className="bg-white rounded-xl shadow-lg p-6">
          <textarea
            className={`w-full h-96 p-4 text-gray-800 rounded-lg border-2 ${
              isEditing ? 'border-blue-300' : 'border-gray-200' // No focus ring on edit
            } resize-none transition-all duration-200`}
            value={groceryText}
            onChange={(e) => setGroceryText(e.target.value)}
            readOnly={!isEditing}
            placeholder="Start typing your grocery list here..."
          />
          <div className="mt-6 flex justify-center space-x-4">
            {isEditing ? (
              <button
                onClick={handleSave}
                className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-8 rounded-full shadow-md transform transition-transform duration-200 hover:scale-105"
              >
                Save Grocery List
              </button>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
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

  // Filtered recipes based on the search term entered by the user.
  const filteredRecipes = recipes.filter(recipe =>
    recipe.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 font-inter text-gray-900">
      {/* Header Section */}
      <header className="bg-white shadow-sm p-4 sticky top-0 z-10">
        <div className="container mx-auto flex flex-col sm:flex-row justify-between items-center">
          <div className="flex items-center space-x-4 mb-4 sm:mb-0">
            {/* App title, acts as a button to navigate to the home view */}
            <h1 className="text-3xl font-extrabold text-blue-700 cursor-pointer" onClick={() => setCurrentView('home')}>RecipeFlow</h1>
            {/* Button to navigate to the Grocery List view */}
            <button
              onClick={() => setCurrentView('groceryList')}
              className={`py-2 px-4 rounded-lg font-semibold transition-colors duration-200 ${
                currentView === 'groceryList' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Grocery List
            </button>
          </div>
          {/* Search bar, only visible on the home view */}
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
        {/* Loading message displayed until Firebase authentication is ready */}
        {!isAuthReady && (
          <div className="text-center py-10 text-gray-600">
            Loading application... Please wait for authentication.
          </div>
        )}
        {isAuthReady && currentView === 'home' && (
          <div className="container mx-auto py-8 px-4">
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

        {isAuthReady && currentView === 'groceryList' && <GroceryList />}
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
