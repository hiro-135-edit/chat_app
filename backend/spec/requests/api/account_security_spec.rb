# frozen_string_literal: true

require 'rails_helper'

RSpec.describe 'Account validation and persistence', type: :request do
  let(:password) { 'Password1234' }
  let(:user) { create_confirmed_user(password:) }
  let(:other_user) { create_confirmed_user }
  let(:headers) { json_headers('X-User-Id' => user.id.to_s) }
  let(:signup) { { name: 'Alice', email: 'alice@example.com', password: 'Password1234' } }

  describe 'registration equivalence partitions' do
    [nil, '', '   '].each do |blank|
      %i[email name password].each do |field|
        it "rejects #{field}=#{blank.inspect} without writing a user" do
          expect do
            post '/api/auth/signup', params: signup.merge(field => blank), as: :json
          end.not_to change(User, :count)
          expect(response).to have_http_status(:unprocessable_entity)
          expect(response.parsed_body).to eq('error' => "missing_#{field}")
        end
      end
    end

    it 'reports duplicate email without replacing the existing account' do
      user
      expect do
        post '/api/auth/signup', params: signup.merge(email: user.email), as: :json
      end.not_to change(User, :count)
      expect(response).to have_http_status(:conflict)
      expect(user.reload.name).to eq('TestUser')
    end

    [
      ['invalid', 'Password1234', 'invalid_email_format'],
      ['valid@example.com', 'Aa1', 'password_invalid_multiple'],
      ['valid@example.com', 'Abc1234', 'password_complexity_invalid'],
      ['valid@example.com', 'abcdefgh', 'password_complexity_invalid'],
      ['valid@example.com', '12345678', 'password_complexity_invalid']
    ].each do |email, new_password, code|
      it "returns #{code} for email/password validation" do
        expect do
          post '/api/auth/signup', params: signup.merge(email:, password: new_password), as: :json
        end.not_to change(User, :count)
        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.parsed_body['error_codes']).to include(code)
      end
    end

    it 'accepts a valid eight-character password and filters unknown attributes' do
      expect do
        post '/api/auth/signup', params: signup.merge(password: 'Abc12345', id: 999_999, encrypted_password: 'injected'), as: :json
      end.to change(User, :count).by(1)
      expect(response).to have_http_status(:ok)
      saved = User.find_by!(email: signup[:email])
      expect(saved.id).not_to eq(999_999)
      expect(saved.valid_password?('Abc12345')).to be(true)
      expect(response.parsed_body.keys).to contain_exactly('id', 'name', 'email')
    end

    it 'accepts the existing nested email input form' do
      post '/api/auth/signup', params: signup.except(:email).merge(registration: { email: signup[:email] }), as: :json
      expect(response).to have_http_status(:ok)
    end
  end

  describe 'login decision table' do
    [[nil, nil], ['', 'Password1234'], ['a@example.com', ''], [' ', ' ']].each do |email, supplied|
      it "rejects missing credentials #{[email, supplied].inspect}" do
        post '/api/auth/login', params: { email:, password: supplied }, as: :json
        expect(response).to have_http_status(:bad_request)
        expect(response.parsed_body).to eq('error' => 'missing_params')
      end
    end

    it 'does not distinguish nonexistent accounts from wrong passwords' do
      post '/api/auth/login', params: { email: 'missing@example.com', password: }, as: :json
      unknown = response.parsed_body
      expect(response).to have_http_status(:unauthorized)
      post '/api/auth/login', params: { email: user.email, password: 'wrong' }, as: :json
      expect(response).to have_http_status(:unauthorized)
      expect(response.parsed_body).to eq(unknown)
    end

    it 'accepts nested credentials without leaking password data' do
      post '/api/auth/login', params: { session: { email: user.email, password: } }, as: :json
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq('id' => user.id, 'name' => user.name, 'email' => user.email)
      delete '/api/auth/logout', as: :json
      expect(response).to have_http_status(:no_content)
    end
  end

  describe 'profile updates' do
    it 'rejects an absent target' do
      patch '/api/users/0', params: { name: 'changed' }, headers:, as: :json
      expect(response).to have_http_status(:not_found)
    end

    ['invalid', ''].each do |email|
      it "rejects email #{email.inspect} and preserves the stored profile" do
        original = user.attributes.slice('name', 'email')
        patch "/api/users/#{user.id}", params: { name: 'changed', email: }, headers:, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.parsed_body['error']).not_to be_empty
        expect(user.reload.attributes.slice('name', 'email')).to eq(original)
      end
    end

    it 'rejects an email already owned by another account' do
      patch "/api/users/#{user.id}", params: { email: other_user.email }, headers:, as: :json
      expect(response).to have_http_status(:unprocessable_entity)
      expect(user.reload.email).not_to eq(other_user.email)
    end

    it 'ignores password and identity fields during profile editing' do
      patch "/api/users/#{user.id}", params: { name: 'Changed', id: other_user.id, password: 'Attack123' }, headers:, as: :json
      expect(response).to have_http_status(:ok)
      expect(user.reload.valid_password?(password)).to be(true)
      expect(other_user.reload.name).to eq('TestUser')
    end

    it 'denies requests without the shared BFF token' do
      patch "/api/users/#{user.id}", params: { name: 'attack' }, headers: { 'X-User-Id' => other_user.id.to_s }, as: :json
      expect(response).to have_http_status(:unauthorized)
      expect(user.reload.name).to eq('TestUser')
    end
  end

  describe 'password updates' do
    it 'rejects a missing user' do
      patch '/api/user/password', params: { user_id: 0, current_password: password }, headers:, as: :json
      expect(response).to have_http_status(:not_found)
    end

    [nil, '', 'wrong'].each do |current|
      it "rejects current password #{current.inspect} without changing the hash" do
        original = user.encrypted_password
        patch '/api/user/password', params: { user_id: user.id, current_password: current, password: 'Next1234', password_confirmation: 'Next1234' }, headers:, as: :json
        expect(response).to have_http_status(:unauthorized)
        expect(user.reload.encrypted_password).to eq(original)
      end
    end

    [%w[Next1234 Mismatch1], %w[Abc1234 Abc1234], %w[lettersOnly lettersOnly]].each do |new_password, confirmation|
      it "rejects invalid replacement #{[new_password, confirmation].inspect}" do
        patch '/api/user/password', params: { user_id: user.id, current_password: password, password: new_password, password_confirmation: confirmation }, headers:, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
        expect(user.reload.valid_password?(password)).to be(true)
      end
    end

    it 'changes only the intended password and invalidates the previous credential' do
      other_user
      patch '/api/user/password', params: { user_id: user.id, current_password: password, password: 'Next1234', password_confirmation: 'Next1234' }, headers:, as: :json
      expect(response).to have_http_status(:ok)
      expect(user.reload.valid_password?('Next1234')).to be(true)
      expect(user.valid_password?(password)).to be(false)
      expect(other_user.reload.valid_password?(password)).to be(true)
    end
  end

  describe 'account deletion' do
    it 'requires requester identity' do
      delete '/api/user', params: { current_password: password }, headers: json_headers, as: :json
      expect(response).to have_http_status(:bad_request)
      expect(response.parsed_body).to eq('error' => 'user_id_missing')
    end

    it 'reports a nonexistent account' do
      delete '/api/user', params: { current_password: password }, headers: json_headers('X-User-Id' => '0'), as: :json
      expect(response).to have_http_status(:not_found)
    end

    [nil, '', ' ', 'wrong'].each do |current|
      it "preserves the account with invalid password #{current.inspect}" do
        user
        expect do
          delete '/api/user', params: { current_password: current }, headers:, as: :json
        end.not_to change(User, :count)
        expect(response).to have_http_status(current.to_s.strip.empty? ? :bad_request : :unauthorized)
      end
    end

    it 'removes the account and dependent content while preserving another account' do
      owned_room = user.rooms.create!(title: 'owned')
      foreign_room = other_user.rooms.create!(title: 'other')
      own_message = owned_room.messages.create!(user: other_user, body: 'reply')
      foreign_message = foreign_room.messages.create!(user:, body: 'comment')
      identity = user.identities.create!(provider: 'google', uid: 'test-id')
      delete '/api/user', params: { current_password: password }, headers:, as: :json
      expect(response).to have_http_status(:ok)
      expect(User.exists?(user.id)).to be(false)
      expect(Room.exists?(owned_room.id)).to be(false)
      expect(Message.where(id: [own_message.id, foreign_message.id])).to be_empty
      expect(Identity.exists?(identity.id)).to be(false)
      expect(User.exists?(other_user.id)).to be(true)
      expect(Room.exists?(foreign_room.id)).to be(true)
    end

    it 'prioritizes the signed-in user over a conflicting requester header' do
      user
      sign_in user
      delete '/api/user', params: { current_password: password }, headers: json_headers('X-User-Id' => other_user.id.to_s), as: :json
      expect(response).to have_http_status(:ok)
      expect(User.exists?(user.id)).to be(false)
      expect(User.exists?(other_user.id)).to be(true)
    end
  end

  describe 'OAuth identity persistence' do
    # Random password composition must not make these unrelated flow tests probabilistic.
    before { allow(SecureRandom).to receive(:base58).with(16).and_return('StablePassword12') }

    [{ provider: '', providerSub: 'id' }, { provider: 'google', providerSub: '' }, {}].each do |body|
      it "rejects incomplete identity #{body.inspect}" do
        expect { post '/api/auth/upsert', params: body, headers:, as: :json }.not_to change(Identity, :count)
        expect(response).to have_http_status(:bad_request)
      end
    end

    it 'links a matching email and updates the display name without duplicating the user' do
      user
      expect do
        post '/api/auth/upsert', params: { upsert: { provider: 'google', providerSub: 'id', email: user.email, name: 'OAuth name' } }, headers:, as: :json
      end.not_to change(User, :count)
      expect(response).to have_http_status(:created)
      expect(user.reload.name).to eq('OAuth name')
      expect(Identity.find_by!(provider: 'google', uid: 'id').user_id).to eq(user.id)
    end

    it 'creates a placeholder email and fallback name when the provider supplies neither' do
      post '/api/auth/upsert', params: { provider: 'twitter', providerSub: 'id' }, headers:, as: :json
      expect(response).to have_http_status(:created)
      created = User.find(response.parsed_body['railsUserId'])
      expect(created.email).to eq('oauth-twitter-id@example.invalid')
      expect(created.name).to eq('名無しユーザー')
    end

    it 'returns validation errors without writing identity or user records' do
      user
      expect do
        post '/api/auth/upsert', params: { provider: 'google', providerSub: 'bad', email: 'invalid' }, headers:, as: :json
      end.not_to change(User, :count)
      expect(response).to have_http_status(:unprocessable_entity)
      expect(Identity.where(uid: 'bad')).to be_empty
    end

    it 'documents random generated passwords without digits failing validation (potential intermittent OAuth failure)' do
      allow(SecureRandom).to receive(:base58).with(16).and_return('OnlyLettersAbcde')
      post '/api/auth/upsert', params: { provider: 'google', providerSub: 'all-letters' }, headers:, as: :json
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body['error']).to eq('validation_error')
      expect(Identity.where(uid: 'all-letters')).to be_empty
    end
  end
end
