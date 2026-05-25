package order

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) FindByID(id string) (*Order, error) {
	return s.repo.FindByID(id)
}

func (s *Service) Create(dto map[string]interface{}) (*Order, error) {
	order := &Order{
		UserID: int64(dto["userId"].(float64)),
		Amount: int64(dto["amount"].(float64)),
		Status: "PLACED",
	}
	return s.repo.Insert(order)
}
