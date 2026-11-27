# frozen_string_literal: true

require 'rails_helper'

RSpec.describe 'Removed legacy controller isolation', type: :routing do
  it 'has no route referring to the removed controllers' do
    controllers = Rails.application.routes.routes.map { |route| route.defaults[:controller] }.compact
    expect(controllers & %w[boards api/confirmations api/auth/social/google_logins]).to be_empty
  end

  ['/boards', '/api/boards', '/api/confirm', '/users/confirmation'].each do |path|
    it "keeps the unsupported endpoint #{path} inaccessible" do
      expect(get: path).not_to be_routable
    end
  end
end
