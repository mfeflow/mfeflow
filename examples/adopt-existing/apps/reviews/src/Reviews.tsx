const reviews = [
  { id: 'r1', text: 'The kettle boils fast.', stars: 5 },
  { id: 'r2', text: 'Nice mug, a bit small.', stars: 4 },
];

export const Reviews = () => (
  <section>
    <h2>Reviews</h2>
    <ul>
      {reviews.map((review) => (
        <li key={review.id}>
          {review.stars}/5: {review.text}
        </li>
      ))}
    </ul>
  </section>
);
