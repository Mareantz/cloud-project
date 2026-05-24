// Entry point for the Azure Functions v4 app.
// This file intentionally only imports function modules so each module can
// self-register via app.http(...) when the runtime loads.

import './functions/health';
import './functions/getRestaurants';
import './functions/getRestaurantById';
import './functions/createRestaurant';
import './functions/getReviews';
import './functions/createReview';
import './functions/uploadPhoto';
import './functions/generateThumbnail';
import './functions/uploadReviewImage';
